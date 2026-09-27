/* =========================================================
   DARALOO SMART ATLAS
   Dynamic Client Application
   All data comes from Google Apps Script
========================================================= */

"use strict";

/* =========================================================
   1. CONFIGURATION
========================================================= */

const CONFIG = {
    gasUrl: "https://script.google.com/macros/s/AKfycbzG767EZxGk6_7TabpZ7L0Yxgru4SXKrmaZW5h6CYdTlVXx8OrgP9hyD8fnMgnG0T__Pg/exec",
    requestTimeout: 30000,
    refreshInterval: 0
};

/* =========================================================
   2. APPLICATION STATE
========================================================= */

const STATE = {
    data: {
        summary: {},
        villages: [],
        nomads: [],
        districts: [],
        projects: [],
        infrastructure: [],
        social: [],
        economy: [],
        environment: [],
        geology: [],
        priorities: [],
        monitoring: [],
        layers: [],
        settings: {}
    },

    currentPage: "dashboard",
    maps: {},
    markers: {},
    charts: {},
    filters: {},
    editing: null,
    loading: false,
    lastSync: null
};


/* =========================================================
   3. HELPERS
========================================================= */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => [...document.querySelectorAll(selector)];

function byId(id) {
    return document.getElementById(id);
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function faNumber(value) {
    return Number(value || 0).toLocaleString("fa-IR");
}

function formatMoney(value) {
    return faNumber(value) + " ریال";
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return escapeHTML(value);
    }

    return date.toLocaleDateString("fa-IR");
}

function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value ?? "—";
}

function setHTML(id, value) {
    const element = byId(id);
    if (element) element.innerHTML = value;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function getValue(object, ...keys) {
    for (const key of keys) {
        if (object && object[key] !== undefined && object[key] !== null) {
            return object[key];
        }
    }
    return "";
}

function showToast(message, type = "info") {
    const container = byId("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

function showLoading(show, message = "در حال دریافت اطلاعات از سرور...") {
    const overlay = byId("loadingOverlay");
    if (!overlay) return;

    const text = overlay.querySelector(".loading-text");
    if (text) text.textContent = message;

    overlay.classList.toggle("hidden", !show);
    STATE.loading = show;
}

function setConnection(status, message) {
    const element = byId("connectionStatus");
    const text = byId("connectionText");

    if (!element || !text) return;

    element.classList.remove("online", "offline");

    if (status === "online") {
        element.classList.add("online");
    } else if (status === "offline") {
        element.classList.add("offline");
    }

    text.textContent = message;
    setText("settingsConnectionStatus", message);
}


/* =========================================================
   4. GOOGLE APPS SCRIPT API
========================================================= */

/*
Expected GET response:

{
  "success": true,
  "data": {
    "summary": {},
    "villages": [],
    "nomads": [],
    "districts": [],
    "projects": [],
    "infrastructure": [],
    "social": [],
    "economy": [],
    "environment": [],
    "geology": [],
    "priorities": [],
    "monitoring": [],
    "layers": [],
    "settings": {}
  }
}

The GAS implementation in the next stage must follow
this response contract.
*/

const API = {

    getUrl() {
        return CONFIG.gasUrl.trim();
    },

    makeUrl(action, params = {}) {
        const base = this.getUrl();

        if (!base) {
            throw new Error("آدرس GAS تنظیم نشده است.");
        }

        const url = new URL(base);

        url.searchParams.set("action", action);

        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.set(
                    key,
                    typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)
                );
            }
        });

        return url;
    },

    jsonp(action, params = {}) {
        return new Promise((resolve, reject) => {
            let script;
            let timeout;

            const callbackName =
                "daralooCallback_" +
                Date.now() +
                "_" +
                Math.random().toString(36).slice(2);

            try {
                const url = this.makeUrl(action, params);
                url.searchParams.set("callback", callbackName);

                script = document.createElement("script");
                script.src = url.toString();
                script.async = true;

                window[callbackName] = (response) => {
                    cleanup();

                    if (!response || response.success === false) {
                        reject(
                            new Error(
                                response?.message ||
                                "پاسخ نامعتبر از سرور"
                            )
                        );
                        return;
                    }

                    resolve(response);
                };

                script.onerror = () => {
                    cleanup();
                    reject(new Error("خطا در ارتباط با GAS"));
                };

                timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error("مهلت پاسخ سرور به پایان رسید."));
                }, CONFIG.requestTimeout);

                document.head.appendChild(script);

            } catch (error) {
                cleanup();
                reject(error);
            }

            function cleanup() {
                if (timeout) clearTimeout(timeout);
                if (script) script.remove();
                delete window[callbackName];
            }
        });
    },

    async get(action, params = {}) {
        return this.jsonp(action, params);
    },

    async write(action, payload = {}) {
        /*
          The GAS endpoint will receive the serialized payload
          in the "payload" query parameter.
          This is intended for small requests.
        */

        return this.jsonp(action, {
            payload: JSON.stringify(payload)
        });
    },

    async loadAll() {
        return this.get("getAll");
    },

    async getEntity(entity, id) {
        return this.get("getOne", {
            entity,
            id
        });
    },

    async create(entity, payload) {
        return this.write("create", {
            entity,
            data: payload
        });
    },

    async update(entity, id, payload) {
        return this.write("update", {
            entity,
            id,
            data: payload
        });
    },

    async remove(entity, id) {
        return this.write("delete", {
            entity,
            id
        });
    },

    async test() {
        return this.get("ping");
    }
};


/* =========================================================
   5. DATA NORMALIZATION
========================================================= */

function normalizeData(response) {
    const data = response?.data ?? response;

    return {
        summary: data.summary || {},

        villages: safeArray(data.villages),

        nomads: safeArray(data.nomads),

        districts: safeArray(data.districts),

        counties: safeArray(data.counties),

        projects: safeArray(data.projects),

        infrastructure: safeArray(data.infrastructure),

        social: safeArray(data.social),

        economy: safeArray(data.economy),

        environment: safeArray(data.environment),

        geology: safeArray(data.geology),

        priorities: safeArray(data.priorities),

        monitoring: safeArray(data.monitoring),

        layers: safeArray(data.layers),

        settings: data.settings || {}
    };
}
/* =========================================================
   6. DATA LOADING
========================================================= */

async function loadData(showMessage = false) {
    if (!API.getUrl()) {
        setConnection("offline", "آدرس GAS تنظیم نشده است");
        showLoading(false);
        return;
    }

    showLoading(true);

    try {
        const response = await API.loadAll();

        STATE.data = normalizeData(response);
        STATE.lastSync = new Date();

        renderAll();
        setConnection("online", "متصل به سرور");

        setText(
            "lastSyncTime",
            STATE.lastSync.toLocaleTimeString("fa-IR")
        );

        setText(
            "apiVersion",
            response.version || response.apiVersion || "—"
        );

        if (showMessage) {
            showToast("اطلاعات با موفقیت دریافت شد.", "success");
        }

    } catch (error) {
        console.error("GAS load error:", error);

        setConnection("offline", "خطا در دریافت اطلاعات");

        if (showMessage) {
            showToast(error.message, "error");
        }

    } finally {
        showLoading(false);
    }
}


/* =========================================================
   7. NAVIGATION
========================================================= */

const PAGE_TITLES = {
    dashboard: "داشبورد مدیریتی",
    map: "نقشه تعاملی GIS",
    villages: "بانک اطلاعات روستاها",
    nomads: "اطلاعات عشایر",
    districts: "دهستان‌ها",
    population: "جمعیت و خانوار",
    infrastructure: "زیرساخت و لجستیک",
    social: "شاخص‌های اجتماعی",
    economy: "اقتصاد و معیشت",
    environment: "محیط زیست",
    geology: "زمین‌شناسی و اراضی",
    projects: "پروژه‌های اجتماعی",
    priorities: "اولویت‌بندی مناطق",
    monitoring: "پایش و ارزیابی",
    reports: "گزارش‌ها",
    settings: "تنظیمات سامانه"
};

function navigate(page) {
    if (!PAGE_TITLES[page]) return;

    STATE.currentPage = page;

    $$(".page").forEach(section => {
        section.classList.toggle(
            "active",
            section.id === `page-${page}`
        );
    });

    $$(".sidebar-link").forEach(link => {
        link.classList.toggle(
            "active",
            link.dataset.page === page
        );
    });

    setText("currentPageTitle", PAGE_TITLES[page]);

    closeMobileMenu();

    if (page === "map") {
        setTimeout(() => {
            STATE.maps.mainMap?.invalidateSize();
        }, 100);
    }

    if (page === "dashboard") {
        setTimeout(() => {
            STATE.maps.dashboardMap?.invalidateSize();
        }, 100);
    }
}

function initNavigation() {
    document.addEventListener("click", event => {
        const link = event.target.closest("[data-page]");
        if (!link) return;

        navigate(link.dataset.page);
    });

    const menuButton = byId("mobileMenuButton");
    const overlay = byId("sidebarOverlay");

    menuButton?.addEventListener("click", openMobileMenu);
    overlay?.addEventListener("click", closeMobileMenu);
}

function openMobileMenu() {
    byId("sidebar")?.classList.add("open");
    byId("sidebarOverlay")?.classList.add("open");
}

function closeMobileMenu() {
    byId("sidebar")?.classList.remove("open");
    byId("sidebarOverlay")?.classList.remove("open");
}


/* =========================================================
   8. DASHBOARD
========================================================= */

function renderDashboard() {
    const data = STATE.data;
    const summary = data.summary;

    setText(
        "kpiVillages",
        faNumber(summary.villages ?? data.villages.length)
    );

    setText(
        "kpiPopulation",
        faNumber(
            summary.population ??
            data.villages.reduce(
                (sum, item) => sum + toNumber(item.population),
                0
            )
        )
    );

    setText(
        "kpiProjects",
        faNumber(summary.projects ?? data.projects.length)
    );

    setText(
        "kpiNomads",
        faNumber(summary.nomads ?? data.nomads.length)
    );

    renderRecentProjects();
    renderProjectChart();
    renderPopulationChart();
    renderPriorityChart();
}


/* =========================================================
   9. PROJECTS
========================================================= */

function projectStatusLabel(status) {
    const labels = {
        planned: "برنامه‌ریزی‌شده",
        ongoing: "در حال اجرا",
        completed: "تکمیل‌شده",
        suspended: "متوقف‌شده",
        cancelled: "لغوشده"
    };

    return labels[status] || status || "نامشخص";
}

function statusClass(status) {
    const classes = {
        planned: "badge-info",
        ongoing: "badge-warning",
        completed: "badge-success",
        suspended: "badge-danger",
        cancelled: "badge-danger"
    };

    return classes[status] || "badge-neutral";
}

function projectRow(project) {
    const id = escapeHTML(project.id);
    const name = escapeHTML(project.name || project.title || "بدون عنوان");
    const location = escapeHTML(project.location || project.villageName || "—");
    const category = escapeHTML(project.category || "—");
    const budget = formatMoney(project.budget);
    const progress = Math.max(
        0,
        Math.min(100, toNumber(project.progress))
    );

    return `
        <tr>
            <td class="table-primary">${name}</td>
            <td>${location}</td>
            <td>${category}</td>
            <td>${budget}</td>
            <td>
                <div class="progress-info">
                    <span>${faNumber(progress)}٪</span>
                </div>
                <div class="progress">
                    <div class="progress-bar"
                         style="width:${progress}%"></div>
                </div>
            </td>
            <td>
                <span class="badge ${statusClass(project.status)}">
                    ${escapeHTML(projectStatusLabel(project.status))}
                </span>
            </td>
            <td>
                <div class="table-actions">
                    <button class="btn btn-secondary btn-sm"
                            data-action="edit"
                            data-entity="projects"
                            data-id="${id}">
                        ویرایش
                    </button>
                    <button class="btn btn-danger btn-sm"
                            data-action="delete"
                            data-entity="projects"
                            data-id="${id}">
                        حذف
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function renderProjects() {
    const search = (
        byId("projectSearch")?.value || ""
    ).trim().toLowerCase();

    const status = byId("projectStatusFilter")?.value || "all";
    const category = byId("projectCategoryFilter")?.value || "all";

    const projects = STATE.data.projects.filter(project => {
        const name = String(project.name || project.title || "").toLowerCase();
        const location = String(
            project.location || project.villageName || ""
        ).toLowerCase();

        const matchesSearch =
            !search ||
            name.includes(search) ||
            location.includes(search);

        const matchesStatus =
            status === "all" || project.status === status;

        const matchesCategory =
            category === "all" || project.category === category;

        return matchesSearch && matchesStatus && matchesCategory;
    });

    setText("projectTableCount", `${faNumber(projects.length)} مورد`);

    setHTML(
        "projectsTable",
        projects.length
            ? projects.map(projectRow).join("")
            : emptyRow(7, "پروژه‌ای یافت نشد")
    );

    renderCategoryOptions();
}

function renderRecentProjects() {
    const projects = STATE.data.projects.slice(0, 6);

    setHTML(
        "recentProjectsTable",
        projects.length
            ? projects.map(project => {
                const id = escapeHTML(project.id);

                return `
                    <tr>
                        <td class="table-primary">
                            ${escapeHTML(project.name || project.title || "—")}
                        </td>
                        <td>
                            ${escapeHTML(project.location || project.villageName || "—")}
                        </td>
                        <td>${escapeHTML(project.category || "—")}</td>
                        <td>${formatMoney(project.budget)}</td>
                        <td>
                            <span class="badge ${statusClass(project.status)}">
                                ${escapeHTML(projectStatusLabel(project.status))}
                            </span>
                        </td>
                        <td>
                            <button class="btn btn-secondary btn-sm"
                                    data-action="edit"
                                    data-entity="projects"
                                    data-id="${id}">
                                مشاهده
                            </button>
                        </td>
                    </tr>
                `;
            }).join("")
            : emptyRow(6, "پروژه‌ای ثبت نشده است")
    );
}

function renderCategoryOptions() {
    const select = byId("projectCategoryFilter");
    if (!select) return;

    const selected = select.value;

    const categories = [
        ...new Set(
            STATE.data.projects
                .map(project => project.category)
                .filter(Boolean)
        )
    ];

    select.innerHTML =
        `<option value="all">تمام حوزه‌ها</option>` +
        categories.map(category => `
            <option value="${escapeHTML(category)}">
                ${escapeHTML(category)}
            </option>
        `).join("");

    if (categories.includes(selected)) {
        select.value = selected;
    }
}


/* =========================================================
   10. VILLAGES
========================================================= */

function villageRow(village) {
    const id = escapeHTML(village.id);

    return `
        <tr>
            <td class="table-primary">
                ${escapeHTML(village.name || "—")}
            </td>
            <td>${escapeHTML(village.districtName || village.district || "—")}</td>
            <td>${faNumber(village.population)}</td>
            <td>${faNumber(village.households)}</td>
            <td>
                <span class="badge badge-neutral">
                    ${escapeHTML(village.dataStatus || "ثبت‌شده")}
                </span>
            </td>
            <td>
                <div class="table-actions">
                    <button class="btn btn-secondary btn-sm"
                            data-action="view"
                            data-entity="villages"
                            data-id="${id}">
                        شناسنامه
                    </button>
                    <button class="btn btn-secondary btn-sm"
                            data-action="edit"
                            data-entity="villages"
                            data-id="${id}">
                        ویرایش
                    </button>
                    <button class="btn btn-danger btn-sm"
                            data-action="delete"
                            data-entity="villages"
                            data-id="${id}">
                        حذف
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function renderVillages() {
    const search = (
        byId("villageSearch")?.value || ""
    ).trim().toLowerCase();

    const district = byId("villageDistrictFilter")?.value || "all";

    const villages = STATE.data.villages.filter(village => {
        const name = String(village.name || "").toLowerCase();

        const matchesSearch = !search || name.includes(search);

        const villageDistrict =
            village.districtId ||
            village.districtName ||
            village.district;

        const matchesDistrict =
            district === "all" ||
            String(villageDistrict) === district;

        return matchesSearch && matchesDistrict;
    });

    setText("villageTableCount", `${faNumber(villages.length)} مورد`);

    setHTML(
        "villagesTable",
        villages.length
            ? villages.map(villageRow).join("")
            : emptyRow(6, "روستایی یافت نشد")
    );

    renderDistrictOptions();
}


/* =========================================================
   11. NOMADS
========================================================= */

function renderNomads() {
    const items = STATE.data.nomads;

    setHTML(
        "nomadsTable",
        items.length
            ? items.map(item => `
                <tr>
                    <td class="table-primary">
                        ${escapeHTML(item.name || "—")}
                    </td>
                    <td>${escapeHTML(item.location || item.region || "—")}</td>
                    <td>${faNumber(item.households)}</td>
                    <td>${faNumber(item.population)}</td>
                    <td>${escapeHTML(item.migrationRoute || item.route || "—")}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn btn-secondary btn-sm"
                                    data-action="edit"
                                    data-entity="nomads"
                                    data-id="${escapeHTML(item.id)}">
                                ویرایش
                            </button>
                            <button class="btn btn-danger btn-sm"
                                    data-action="delete"
                                    data-entity="nomads"
                                    data-id="${escapeHTML(item.id)}">
                                حذف
                            </button>
                        </div>
                    </td>
                </tr>
            `).join("")
            : emptyRow(6, "اطلاعات عشایری ثبت نشده است")
    );
}


/* =========================================================
   12. DISTRICTS
========================================================= */

function renderDistricts() {
    const districts = STATE.data.districts;

    setHTML(
        "districtsTable",
        districts.length
            ? districts.map(district => {
                const villages = STATE.data.villages.filter(village =>
                    String(village.districtId || village.district) ===
                    String(district.id)
                );

                const population = villages.reduce(
                    (sum, village) => sum + toNumber(village.population),
                    0
                );

                return `
                    <tr>
                        <td class="table-primary">
                            ${escapeHTML(district.name || "—")}
                        </td>
                        <td>${escapeHTML(district.section || district.bakhsh || "—")}</td>
                        <td>${faNumber(district.villageCount ?? villages.length)}</td>
                        <td>${faNumber(district.population ?? population)}</td>
                        <td>
                            <div class="table-actions">
                                <button class="btn btn-secondary btn-sm"
                                        data-action="edit"
                                        data-entity="districts"
                                        data-id="${escapeHTML(district.id)}">
                                    ویرایش
                                </button>
                                <button class="btn btn-danger btn-sm"
                                        data-action="delete"
                                        data-entity="districts"
                                        data-id="${escapeHTML(district.id)}">
                                    حذف
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join("")
            : emptyRow(5, "دهستانی ثبت نشده است")
    );

    renderDistrictOptions();
}

function renderDistrictOptions() {
    const selects = [
        byId("villageDistrictFilter"),
        byId("mapDistrictFilter")
    ].filter(Boolean);

    const districts = STATE.data.districts;

    selects.forEach(select => {
        const selected = select.value;

        select.innerHTML =
            `<option value="all">همه دهستان‌ها</option>` +
            districts.map(district => `
                <option value="${escapeHTML(district.id)}">
                    ${escapeHTML(district.name)}
                </option>
            `).join("");

        if (districts.some(item => String(item.id) === selected)) {
            select.value = selected;
        }
    });
}


/* =========================================================
   13. GENERIC DATA TABLES
========================================================= */

function renderGenericTable(elementId, items, columns, entity) {
    const element = byId(elementId);
    if (!element) return;

    if (!items.length) {
        element.innerHTML = emptyRow(
            columns.length + 1,
            "اطلاعاتی ثبت نشده است"
        );
        return;
    }

    element.innerHTML = items.map(item => `
        <tr>
            ${columns.map(column => `
                <td>
                    ${escapeHTML(
                        typeof column.value === "function"
                            ? column.value(item)
                            : item[column.key] ?? "—"
                    )}
                </td>
            `).join("")}
            <td>
                <div class="table-actions">
                    <button class="btn btn-secondary btn-sm"
                            data-action="edit"
                            data-entity="${entity}"
                            data-id="${escapeHTML(item.id)}">
                        ویرایش
                    </button>
                    <button class="btn btn-danger btn-sm"
                            data-action="delete"
                            data-entity="${entity}"
                            data-id="${escapeHTML(item.id)}">
                        حذف
                    </button>
                </div>
            </td>
        </tr>
    `).join("");
}

function renderInfrastructure() {
    renderGenericTable(
        "infrastructureTable",
        STATE.data.infrastructure,
        [
            { key: "location" },
            { key: "water" },
            { key: "electricity" },
            { key: "gas" },
            { key: "road" },
            { key: "internet" }
        ],
        "infrastructure"
    );
}

function renderSocial() {
    renderGenericTable(
        "socialTable",
        STATE.data.social,
        [
            { key: "location" },
            { key: "schools" },
            { key: "healthCenters" },
            { key: "culturalSpaces" },
            { key: "sportsSpaces" }
        ],
        "social"
    );
}

function renderEconomy() {
    renderGenericTable(
        "economyTable",
        STATE.data.economy,
        [
            { key: "location" },
            { key: "mainActivity" },
            { key: "employment" },
            { key: "agriculture" },
            { key: "livestock" }
        ],
        "economy"
    );
}

function renderEnvironment() {
    renderGenericTable(
        "environmentTable",
        STATE.data.environment,
        [
            { key: "location" },
            { key: "waterResources" },
            { key: "vegetation" },
            { key: "hazards" },
            { key: "status" }
        ],
        "environment"
    );
}

function renderGeology() {
    renderGenericTable(
        "geologyTable",
        STATE.data.geology,
        [
            { key: "name" },
            { key: "type" },
            { key: "area" },
            { key: "location" }
        ],
        "geology"
    );
}


/* =========================================================
   14. POPULATION
========================================================= */

function renderPopulation() {
    const villages = STATE.data.villages;

    const population = villages.reduce(
        (sum, village) => sum + toNumber(village.population),
        0
    );

    const households = villages.reduce(
        (sum, village) => sum + toNumber(village.households),
        0
    );

    setText("populationTotal", faNumber(population));
    setText("householdTotal", faNumber(households));

    setText(
        "householdAverage",
        households ? (population / households).toFixed(2) : "—"
    );

    renderChart(
        "populationDetailChart",
        "bar",
        {
            labels: villages.map(village => village.name || ""),
            datasets: [{
                label: "جمعیت",
                data: villages.map(village => toNumber(village.population)),
                borderWidth: 1
            }]
        }
    );
}


/* =========================================================
   15. PRIORITIES
========================================================= */

function renderPriorities() {
    const priorities = STATE.data.priorities;

    setHTML(
        "priorityTable",
        priorities.length
            ? priorities.map((item, index) => `
                <tr>
                    <td>${faNumber(item.rank ?? index + 1)}</td>
                    <td class="table-primary">
                        ${escapeHTML(item.name || item.villageName || "—")}
                    </td>
                    <td>${faNumber(item.score)}</td>
                    <td>
                        <span class="badge ${
                            item.level === "high"
                                ? "badge-danger"
                                : item.level === "medium"
                                    ? "badge-warning"
                                    : "badge-success"
                        }">
                            ${escapeHTML(item.levelLabel || item.level || "—")}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-secondary btn-sm"
                                data-action="view"
                                data-entity="priorities"
                                data-id="${escapeHTML(item.id)}">
                            جزئیات
                        </button>
                    </td>
                </tr>
            `).join("")
            : emptyRow(5, "نتیجه‌ای برای اولویت‌بندی دریافت نشده است")
    );

    const weights = STATE.data.settings.priorityWeights || [];

    setHTML(
        "priorityWeights",
        weights.length
            ? weights.map(item => `
                <div style="margin-bottom:15px">
                    <div class="progress-info">
                        <span class="progress-label">
                            ${escapeHTML(item.name)}
                        </span>
                        <span class="progress-value">
                            ${faNumber(item.weight)}٪
                        </span>
                    </div>
                    <div class="progress">
                        <div class="progress-bar"
                             style="width:${Math.min(100, toNumber(item.weight))}%">
                        </div>
                    </div>
                </div>
            `).join("")
            : `<div class="empty-state">وزن شاخص‌ها از سرور دریافت نشده است</div>`
    );
}


/* =========================================================
   16. MONITORING
========================================================= */


function renderMonitoring() {
    const items = STATE.data.monitoring;

    setHTML(
        "monitoringTable",
        items.length
            ? items.map(item => `
                <tr>
                    <td class="table-primary">
                        ${escapeHTML(item.projectName || "—")}
                    </td>
                    <td>${escapeHTML(item.location || "—")}</td>
                    <td>${formatDate(item.date)}</td>
                    <td>
                        <div class="progress-info">
                            <span>${faNumber(item.progress)}٪</span>
                        </div>
                        <div class="progress">
                            <div class="progress-bar"
                                 style="width:${Math.max(0, Math.min(100, toNumber(item.progress)))}%">
                            </div>
                        </div>
                    </td>
                    <td>${escapeHTML(item.status || "—")}</td>
                    <td>
                        <div class="table-actions">
                            <button class="btn btn-secondary btn-sm"
                                    data-action="edit"
                                    data-entity="monitoring"
                                    data-id="${escapeHTML(item.id)}">
                                ویرایش
                            </button>
                            <button class="btn btn-danger btn-sm"
                                    data-action="delete"
                                    data-entity="monitoring"
                                    data-id="${escapeHTML(item.id)}">
                                حذف
                            </button>
                        </div>
                    </td>
                </tr>
            `).join("")
            : emptyRow(6, "گزارش پایشی ثبت نشده است")
    );
}




/* =========================================================
   17. CHARTS
========================================================= */

function renderChart(canvasId, type, data) {
    const canvas = byId(canvasId);
    if (!canvas || !window.Chart) return;

    if (STATE.charts[canvasId]) {
        STATE.charts[canvasId].destroy();
    }

    STATE.charts[canvasId] = new Chart(canvas, {
        type,
        data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: "#a1aab8",
                        font: {
                            family: "Tahoma"
                        }
                    }
                }
            },
            scales: type === "doughnut" ? {} : {
                x: {
                    ticks: {
                        color: "#a1aab8",
                        font: { family: "Tahoma" }
                    },
                    grid: {
                        color: "rgba(255,255,255,0.05)"
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: "#a1aab8",
                        font: { family: "Tahoma" }
                    },
                    grid: {
                        color: "rgba(255,255,255,0.05)"
                    }
                }
            }
        }
    });
}

function renderProjectChart() {

    const projects = safeArray(STATE.data.projects);

    /*
     * وضعیت‌های استاندارد پروژه
     */
    const statuses = [
        "planned",
        "ongoing",
        "completed",
        "suspended"
    ];


    /*
     * تشخیص وضعیت پروژه
     * هم مقادیر انگلیسی و هم مقادیر فارسی را پشتیبانی می‌کند.
     */
    function normalizeProjectStatus(status) {

        const value = String(status ?? "")
            .trim()
            .toLowerCase();

        switch (value) {

            case "planned":
            case "planned-project":
            case "برنامه‌ریزی‌شده":
            case "برنامه ریزی شده":
            case "برنامه‌ریزی شده":
                return "planned";


            case "ongoing":
            case "in progress":
            case "در حال اجرا":
            case "درحال اجرا":
                return "ongoing";


            case "completed":
            case "complete":
            case "تکمیل‌شده":
            case "تکمیل شده":
            case "کامل شده":
                return "completed";


            case "suspended":
            case "stopped":
            case "متوقف‌شده":
            case "متوقف شده":
                return "suspended";


            default:
                return null;
        }
    }


    /*
     * شمارش پروژه‌ها بر اساس وضعیت
     */
    const counts = {
        planned: 0,
        ongoing: 0,
        completed: 0,
        suspended: 0
    };


    projects.forEach(project => {

        const status = normalizeProjectStatus(
            project.status
        );

        if (status && counts[status] !== undefined) {
            counts[status]++;
        }

    });


    /*
     * برچسب‌های فارسی نمودار
     */
    const labels = [
        "برنامه‌ریزی‌شده",
        "در حال اجرا",
        "تکمیل‌شده",
        "متوقف‌شده"
    ];


    /*
     * اگر پروژه‌ای وجود ندارد،
     * نمودار خالی ایجاد نشود.
     */
    if (projects.length === 0) {

        const canvas = byId("projectStatusChart");

        if (canvas) {

            const parent =
                canvas.parentElement;

            parent.innerHTML = `
                <div class="empty-state"
                     style="height:100%;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            flex-direction:column;">

                    <div class="empty-state-icon">📊</div>

                    <div class="empty-state-title">
                        اطلاعات پروژه‌ای ثبت نشده است
                    </div>

                </div>
            `;

        }

        return;
    }


    /*
     * رسم نمودار
     */
    renderChart(
        "projectStatusChart",
        "doughnut",
        {
            labels: labels,

            datasets: [
                {
                    data: [
                        counts.planned,
                        counts.ongoing,
                        counts.completed,
                        counts.suspended
                    ],

                    backgroundColor: [
                        "#f59e0b",
                        "#3b82f6",
                        "#22c55e",
                        "#ef4444"
                    ],

                    borderWidth: 2,

                    borderColor: "#111827"
                }
            ]
        }
    );

}

function renderPopulationChart() {
    const villages = STATE.data.villages.slice(0, 10);

    renderChart("populationChart", "bar", {
        labels: villages.map(village => village.name || ""),
        datasets: [{
            label: "جمعیت",
            data: villages.map(village => toNumber(village.population)),
            borderWidth: 1
        }]
    });
}

function renderPriorityChart() {
    const priorities = STATE.data.priorities.slice(0, 10);

    renderChart("priorityChart", "bar", {
        labels: priorities.map(item => item.name || item.villageName || ""),
        datasets: [{
            label: "امتیاز اولویت",
            data: priorities.map(item => toNumber(item.score)),
            borderWidth: 1
        }]
    });
}


/* =========================================================
   18. MAPS
========================================================= */

function initMap(elementId, mapKey) {
    if (!window.L || !byId(elementId)) return null;

    if (STATE.maps[mapKey]) {
        STATE.maps[mapKey].remove();
    }

    const map = L.map(elementId).setView([29.5, 56.8], 8);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap"
        }
    ).addTo(map);

    STATE.maps[mapKey] = map;
    STATE.markers[mapKey] = L.layerGroup().addTo(map);

    return map;
}

function initMaps() {
    initMap("dashboardMap", "dashboardMap");
    initMap("mainMap", "mainMap");
    renderMapLayers();
}

function getCoordinates(item) {
    const lat = Number(item.latitude ?? item.lat);
    const lng = Number(item.longitude ?? item.lng ?? item.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }

    return [lat, lng];
}

function addPoint(layer, item, color, title, description) {
    const coordinates = getCoordinates(item);
    if (!coordinates) return;

    const marker = L.circleMarker(coordinates, {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.8,
        weight: 2
    });

    marker.bindPopup(`
        <div dir="rtl" style="min-width:150px">
            <strong>${escapeHTML(title)}</strong>
            <br>
            <span>${escapeHTML(description || "")}</span>
        </div>
    `);

    marker.addTo(layer);
}

function renderMapLayers() {

    const showVillage =
        byId("mapFilterVillage")?.checked ?? true;

    const showNomad =
        byId("mapFilterNomad")?.checked ?? true;

    const showDistrict =
        byId("mapFilterDistrict")?.checked ?? true;

    const showCounty =
        byId("mapFilterCounty")?.checked ?? true;


    const selectedDistrict =
        byId("mapDistrictFilter")?.value || "all";


    const COLORS = {
        village: "#f28c28",
        nomad: "#38bdf8",
        district: "#22c55e",
        county: "#a855f7"
    };


    ["mainMap", "dashboardMap"].forEach(mapKey => {

        const layer = STATE.markers[mapKey];

        if (!layer) return;


        // پاک کردن نمایش قبلی
        layer.clearLayers();


        /* =====================================================
           روستاها
        ===================================================== */

        if (showVillage) {

            safeArray(STATE.data.villages).forEach(item => {

                if (
                    selectedDistrict !== "all" &&
                    String(
                        item.districtId ??
                        item.district ??
                        ""
                    ) !== String(selectedDistrict)
                ) {
                    return;
                }


                addPoint(
                    layer,
                    item,
                    COLORS.village,
                    item.name || "روستا",
                    "روستا"
                );

            });

        }


        /* =====================================================
           عشایر
        ===================================================== */

        if (showNomad) {

            safeArray(STATE.data.nomads).forEach(item => {

                if (
                    selectedDistrict !== "all" &&
                    String(
                        item.districtId ??
                        item.district ??
                        ""
                    ) !== String(selectedDistrict)
                ) {
                    return;
                }


                addPoint(
                    layer,
                    item,
                    COLORS.nomad,
                    item.name || "گروه عشایری",
                    "عشایر"
                );

            });

        }


        /* =====================================================
           دهستان‌ها
        ===================================================== */

        if (showDistrict) {

            safeArray(STATE.data.districts).forEach(item => {

                if (
                    selectedDistrict !== "all" &&
                    String(item.id ?? "") !==
                    String(selectedDistrict)
                ) {
                    return;
                }


                addPoint(
                    layer,
                    item,
                    COLORS.district,
                    item.name || "دهستان",
                    "دهستان"
                );

            });

        }


        /* =====================================================
           شهرستان‌ها
        ===================================================== */

        if (showCounty) {

            safeArray(STATE.data.counties).forEach(item => {

                addPoint(
                    layer,
                    item,
                    COLORS.county,
                    item.name || "شهرستان",
                    "شهرستان"
                );

            });

        }

    });

}


/* =========================================================
   19. MODAL
========================================================= */

function openModal(title, body, saveLabel = "ذخیره اطلاعات") {
    setText("modalTitle", title);
    setHTML("modalBody", body);
    setText("modalSaveButton", saveLabel);

    byId("modalBackdrop")?.classList.add("open");
}

function closeModal() {
    byId("modalBackdrop")?.classList.remove("open");
    STATE.editing = null;
}

function initModal() {
    byId("modalCloseButton")?.addEventListener("click", closeModal);
    byId("modalCancelButton")?.addEventListener("click", closeModal);

    byId("modalBackdrop")?.addEventListener("click", event => {
        if (event.target.id === "modalBackdrop") {
            closeModal();
        }
    });
}
/* =========================================================
   20. DYNAMIC FORMS
========================================================= */

const FORM_FIELDS = {
    villages: [
        { name: "name", label: "نام روستا", required: true },
        { name: "districtId", label: "شناسه دهستان" },
        { name: "population", label: "جمعیت", type: "number" },
        { name: "households", label: "تعداد خانوار", type: "number" },
        { name: "latitude", label: "عرض جغرافیایی", type: "number" },
        { name: "longitude", label: "طول جغرافیایی", type: "number" },
        { name: "dataStatus", label: "وضعیت اطلاعات" }
    ],

    nomads: [
        { name: "name", label: "نام گروه عشایری", required: true },
        { name: "location", label: "منطقه" },
        { name: "population", label: "جمعیت", type: "number" },
        { name: "households", label: "تعداد خانوار", type: "number" },
        { name: "migrationRoute", label: "مسیر کوچ" },
        { name: "latitude", label: "عرض جغرافیایی", type: "number" },
        { name: "longitude", label: "طول جغرافیایی", type: "number" }
    ],

    districts: [
        { name: "name", label: "نام دهستان", required: true },
        { name: "section", label: "بخش" }
    ],

    projects: [
        { name: "name", label: "عنوان پروژه", required: true },
        { name: "location", label: "منطقه" },
        { name: "category", label: "حوزه پروژه" },
        { name: "budget", label: "بودجه", type: "number" },
        { name: "progress", label: "درصد پیشرفت", type: "number" },
        {
            name: "status",
            label: "وضعیت",
            type: "select",
            options: [
                ["planned", "برنامه‌ریزی‌شده"],
                ["ongoing", "در حال اجرا"],
                ["completed", "تکمیل‌شده"],
                ["suspended", "متوقف‌شده"]
            ]
        },
        { name: "description", label: "توضیحات", type: "textarea" }
    ],

    infrastructure: [
        { name: "location", label: "منطقه", required: true },
        { name: "water", label: "وضعیت آب" },
        { name: "electricity", label: "وضعیت برق" },
        { name: "gas", label: "وضعیت گاز" },
        { name: "road", label: "وضعیت راه دسترسی" },
        { name: "internet", label: "وضعیت اینترنت" }
    ],

    social: [
        { name: "location", label: "منطقه", required: true },
        { name: "schools", label: "تعداد مدارس", type: "number" },
        { name: "healthCenters", label: "مراکز درمانی", type: "number" },
        { name: "culturalSpaces", label: "فضاهای فرهنگی", type: "number" },
        { name: "sportsSpaces", label: "فضاهای ورزشی", type: "number" }
    ],

    economy: [
        { name: "location", label: "منطقه", required: true },
        { name: "mainActivity", label: "فعالیت غالب" },
        { name: "employment", label: "اشتغال" },
        { name: "agriculture", label: "کشاورزی" },
        { name: "livestock", label: "دامداری" }
    ],

    environment: [
        { name: "location", label: "منطقه", required: true },
        { name: "waterResources", label: "منابع آب" },
        { name: "vegetation", label: "پوشش گیاهی" },
        { name: "hazards", label: "مخاطرات" },
        { name: "status", label: "وضعیت محیط زیست" }
    ],

    geology: [
        { name: "name", label: "عنوان", required: true },
        { name: "type", label: "نوع لایه" },
        { name: "area", label: "مساحت" },
        { name: "location", label: "منطقه" }
    ],

    monitoring: [
        { name: "projectName", label: "عنوان پروژه", required: true },
        { name: "location", label: "منطقه" },
        { name: "date", label: "تاریخ پایش", type: "date" },
        { name: "progress", label: "درصد پیشرفت", type: "number" },
        { name: "status", label: "وضعیت" },
        { name: "description", label: "توضیحات", type: "textarea" }
    ]
};

const ENTITY_LABELS = {
    villages: "روستا",
    nomads: "گروه عشایری",
    districts: "دهستان",
    projects: "پروژه",
    infrastructure: "زیرساخت",
    social: "اطلاعات اجتماعی",
    economy: "اطلاعات اقتصادی",
    environment: "اطلاعات محیط زیست",
    geology: "لایه زمین‌شناسی",
    monitoring: "گزارش پایش"
};

function createField(field, value = "") {
    const id = `field_${field.name}`;
    const required = field.required ? "required" : "";
    const type = field.type || "text";

    let input;

    if (type === "textarea") {
        input = `
            <textarea class="form-control"
                      id="${id}"
                      name="${field.name}"
                      ${required}>${escapeHTML(value)}</textarea>
        `;
    } else if (type === "select") {
        input = `
            <select class="form-control"
                    id="${id}"
                    name="${field.name}"
                    ${required}>
                <option value="">انتخاب کنید</option>
                ${(field.options || []).map(option => `
                    <option value="${escapeHTML(option[0])}"
                        ${String(value) === String(option[0]) ? "selected" : ""}>
                        ${escapeHTML(option[1])}
                    </option>
                `).join("")}
            </select>
        `;
    } else {
        input = `
            <input class="form-control"
                   id="${id}"
                   name="${field.name}"
                   type="${type}"
                   value="${escapeHTML(value)}"
                   ${required}>
        `;
    }

    return `
        <div class="form-group">
            <label class="form-label" for="${id}">
                ${escapeHTML(field.label)}
            </label>
            ${input}
        </div>
    `;
}

function openEntityForm(entity, item = null) {
    const fields = FORM_FIELDS[entity];

    if (!fields) {
        showToast("فرم این بخش هنوز تعریف نشده است.", "warning");
        return;
    }

    STATE.editing = {
        entity,
        id: item?.id || null
    };

    const form = `
        <form id="entityForm">
            <div class="form-grid">
                ${fields.map(field =>
                    createField(field, item?.[field.name] ?? "")
                ).join("")}
            </div>
        </form>
    `;

    openModal(
        item
            ? `ویرایش ${ENTITY_LABELS[entity]}`
            : `ثبت ${ENTITY_LABELS[entity]}`,
        form
    );

    byId("modalSaveButton").onclick = saveEntityForm;
}

async function saveEntityForm() {
    const form = byId("entityForm");
    if (!form || !STATE.editing) return;

    if (!form.reportValidity()) return;

    const { entity, id } = STATE.editing;
    const payload = {};

    new FormData(form).forEach((value, key) => {
        const field = FORM_FIELDS[entity].find(item => item.name === key);
        payload[key] = field?.type === "number"
            ? (value === "" ? "" : Number(value))
            : value;
    });

    const saveButton = byId("modalSaveButton");
    saveButton.disabled = true;
    saveButton.textContent = "در حال ذخیره...";

    try {
        const response = id
            ? await API.update(entity, id, payload)
            : await API.create(entity, payload);

        if (response.success === false) {
            throw new Error(response.message || "ذخیره اطلاعات ناموفق بود.");
        }

        closeModal();
        await loadData(false);

        showToast("اطلاعات با موفقیت ذخیره شد.", "success");

    } catch (error) {
        console.error(error);
        showToast(error.message, "error");

    } finally {
        saveButton.disabled = false;
        saveButton.textContent = "ذخیره اطلاعات";
    }
}


/* =========================================================
   21. CRUD ACTIONS
========================================================= */

function findEntityItem(entity, id) {
    const collection = STATE.data[entity];
    if (!Array.isArray(collection)) return null;

    return collection.find(item => String(item.id) === String(id)) || null;
}

async function handleEntityAction(action, entity, id) {
    const item = findEntityItem(entity, id);

    if (action === "view") {
        if (!item) {
            showToast("اطلاعات موردنظر پیدا نشد.", "error");
            return;
        }

        if (entity === "villages") {
            openVillageDetails(item);
        } else {
            openDetails(entity, item);
        }
        return;
    }

    if (action === "edit") {
        if (!item) {
            showToast("اطلاعات موردنظر پیدا نشد.", "error");
            return;
        }

        openEntityForm(entity, item);
        return;
    }

    if (action === "delete") {
        if (!confirm("آیا از حذف این اطلاعات اطمینان دارید؟")) {
            return;
        }

        try {
            await API.remove(entity, id);
            await loadData(false);
            showToast("اطلاعات حذف شد.", "success");
        } catch (error) {
            showToast(error.message, "error");
        }
    }
}

function initEntityActions() {
    document.addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;

        const { action, entity, id } = button.dataset;

        if (!action || !entity || !id) return;

        handleEntityAction(action, entity, id);
    });
}


/* =========================================================
   22. DETAILS
========================================================= */

function openDetails(entity, item) {
    const fields = FORM_FIELDS[entity] || [];

    const body = `
        <div class="detail-grid">
            ${fields.map(field => `
                <div class="detail-item">
                    <div class="detail-label">
                        ${escapeHTML(field.label)}
                    </div>
                    <div class="detail-value">
                        ${escapeHTML(item[field.name] ?? "—")}
                    </div>
                </div>
            `).join("")}
        </div>
    `;

    openModal(
        `جزئیات ${ENTITY_LABELS[entity] || "اطلاعات"}`,
        body,
        "بستن"
    );

    byId("modalSaveButton").onclick = closeModal;
}

function openVillageDetails(village) {
    const fields = [
        ["نام روستا", village.name],
        ["دهستان", village.districtName || village.district],
        ["جمعیت", faNumber(village.population)],
        ["تعداد خانوار", faNumber(village.households)],
        ["عرض جغرافیایی", village.latitude || village.lat],
        ["طول جغرافیایی", village.longitude || village.lng],
        ["وضعیت اطلاعات", village.dataStatus]
    ];

    const body = `
        <div class="detail-grid">
            ${fields.map(([label, value]) => `
                <div class="detail-item">
                    <div class="detail-label">${escapeHTML(label)}</div>
                    <div class="detail-value">${escapeHTML(value || "—")}</div>
                </div>
            `).join("")}
        </div>

        <br>
        <div class="card-title">توضیحات</div>
        <p style="color:var(--text-secondary);margin-top:8px">
            ${escapeHTML(village.description || "توضیحی ثبت نشده است.")}
        </p>
    `;

    openModal("شناسنامه روستا", body, "بستن");
    byId("modalSaveButton").onclick = closeModal;
}


/* =========================================================
   23. ADD BUTTONS
========================================================= */

function initAddButtons() {
    const buttons = {
        addVillageButton: "villages",
        addNomadButton: "nomads",
        addDistrictButton: "districts",
        addProjectButton: "projects",
        addMonitoringButton: "monitoring"
    };

    Object.entries(buttons).forEach(([id, entity]) => {
        byId(id)?.addEventListener("click", () => {
            openEntityForm(entity);
        });
    });
}


/* =========================================================
   24. PRIORITY CALCULATION
========================================================= */

async function calculatePriorities() {
    const button = byId("calculatePriorityButton");
    if (button) {
        button.disabled = true;
        button.textContent = "در حال محاسبه...";
    }

    try {
        await API.get("calculatePriorities");
        await loadData(false);

        showToast("درخواست محاسبه اولویت‌ها ارسال شد.", "success");

    } catch (error) {
        showToast(error.message, "error");

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "محاسبه اولویت‌ها";
        }
    }
}


/* =========================================================
   25. FILTERS AND SEARCH
========================================================= */

function initFilters() {

    /* =====================================================
       فیلترهای روستاها
    ===================================================== */

    byId("villageSearch")?.addEventListener(
        "input",
        renderVillages
    );

    byId("villageDistrictFilter")?.addEventListener(
        "change",
        renderVillages
    );


    /* =====================================================
       فیلترهای پروژه‌ها
    ===================================================== */

    byId("projectSearch")?.addEventListener(
        "input",
        renderProjects
    );

    byId("projectStatusFilter")?.addEventListener(
        "change",
        renderProjects
    );

    byId("projectCategoryFilter")?.addEventListener(
        "change",
        renderProjects
    );


    /* =====================================================
       فیلتر دسته‌های نقشه
       
       روستاها
       عشایر
       دهستان‌ها
       شهرستان‌ها
    ===================================================== */

    [
        "mapFilterVillage",
        "mapFilterNomad",
        "mapFilterDistrict",
        "mapFilterCounty"
    ].forEach(id => {

        byId(id)?.addEventListener(
            "change",
            renderMapLayers
        );

    });


    /* =====================================================
       فیلتر دهستان روی نقشه
    ===================================================== */

    byId("mapDistrictFilter")?.addEventListener(
        "change",
        renderMapLayers
    );


    /* =====================================================
       Reset فیلتر روستاها
    ===================================================== */

    byId("villageReset")?.addEventListener(
        "click",
        () => {

            if (byId("villageSearch")) {
                byId("villageSearch").value = "";
            }

            if (byId("villageDistrictFilter")) {
                byId("villageDistrictFilter").value = "all";
            }

            renderVillages();

        }
    );


    /* =====================================================
       جستجوی سراسری
    ===================================================== */

    byId("globalSearch")?.addEventListener(
        "keydown",
        event => {

            if (event.key !== "Enter") return;


            const value =
                event.target.value.trim();


            if (!value) return;


            if (byId("villageSearch")) {
                byId("villageSearch").value = value;
            }


            navigate("villages");

            renderVillages();

        }
    );

}


/* =========================================================
   26. EXPORT
========================================================= */

function downloadJSON(filename, data) {
    const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
}

function exportData(entity) {
    const data = entity === "all"
        ? STATE.data
        : STATE.data[entity];

    if (!data) {
        showToast("اطلاعاتی برای خروجی وجود ندارد.", "warning");
        return;
    }

    downloadJSON(`daraloo_${entity}.json`, data);
}

function initExports() {
    byId("exportVillagesButton")?.addEventListener(
        "click",
        () => exportData("villages")
    );

    byId("exportProjectsButton")?.addEventListener(
        "click",
        () => exportData("projects")
    );

    byId("exportAllButton")?.addEventListener(
        "click",
        () => exportData("all")
    );
}


/* =========================================================
   27. SETTINGS
========================================================= */

function initSettings() {
    const input = byId("gasUrlInput");
    if (input) input.value = CONFIG.gasUrl;

    byId("saveGasUrlButton")?.addEventListener("click", () => {
        const url = input?.value.trim() || "";

        if (url && !url.startsWith("https://script.google.com/")) {
            showToast("آدرس واردشده معتبر نیست.", "error");
            return;
        }

        CONFIG.gasUrl = url;

        localStorage.setItem("daraloo_gas_url", url);

        showToast("آدرس سرویس ذخیره شد.", "success");
    });

    byId("testConnectionButton")?.addEventListener("click", testConnection);
}

async function testConnection() {
    try {
        setConnection("checking", "در حال آزمایش اتصال");

        const response = await API.test();

        if (response.success === false) {
            throw new Error(response.message || "اتصال ناموفق بود.");
        }

        setConnection("online", "اتصال موفق");
        showToast("اتصال به GAS برقرار است.", "success");

    } catch (error) {
        setConnection("offline", "اتصال ناموفق");
        showToast(error.message, "error");
    }
}


/* =========================================================
   28. EMPTY TABLE
========================================================= */

function emptyRow(colspan, message) {
    return `
        <tr>
            <td colspan="${colspan}">
                <div class="empty-state">
                    <div class="empty-state-icon">⌕</div>
                    <div class="empty-state-title">
                        ${escapeHTML(message)}
                    </div>
                </div>
            </td>
        </tr>
    `;
}


/* =========================================================
   29. RENDER ALL
========================================================= */

function renderAll() {

    const data = STATE.data;

    populateMapDistrictFilter();

    setText(
        "villageCount",
        faNumber(data.villages.length)
    );

    setText(
        "nomadCount",
        faNumber(data.nomads.length)
    );
    setText("projectCount",
	faNumber(data.projects.length));

    renderDashboard();
    renderVillages();
    renderNomads();
    renderDistricts();

    renderPopulation();
    renderInfrastructure();
    renderSocial();
    renderEconomy();
    renderEnvironment();
    renderGeology();

    renderProjects();
    renderPriorities();
    renderMonitoring();
    renderMapLayers();
}


/* =========================================================
   30. EVENT INITIALIZATION
========================================================= */

function initEvents() {
    initNavigation();
    initModal();
    initEntityActions();
    initAddButtons();
    initFilters();
    initExports();
    initSettings();

    byId("refreshButton")?.addEventListener(
        "click",
        () => loadData(true)
    );

    byId("dashboardRefresh")?.addEventListener(
        "click",
        () => loadData(true)
    );

    byId("mapRefresh")?.addEventListener(
        "click",
        () => loadData(true)
    );

    byId("calculatePriorityButton")?.addEventListener(
        "click",
        calculatePriorities
    );
}


/* =========================================================
   31. APPLICATION START
========================================================= */

async function startApplication() {
    initEvents();
    initMaps();

    setConnection("checking", "در حال اتصال به سرور");

    if (!CONFIG.gasUrl) {
        setConnection("offline", "آدرس GAS تنظیم نشده است");
        showLoading(false);
        navigate("settings");
        showToast("ابتدا آدرس GAS را در تنظیمات وارد کنید.", "warning");
        return;
    }

    await loadData();
}

document.addEventListener("DOMContentLoaded", startApplication);




function populateMapDistrictFilter() {

    const select = byId("mapDistrictFilter");

    if (!select) return;


    const districts = STATE.data.districts || [];


    select.innerHTML = `
        <option value="all">
            همه دهستان‌ها
        </option>
    `;


    districts.forEach(district => {

        const option = document.createElement("option");

        option.value = district.id || "";

        option.textContent =
            district.name || "دهستان بدون نام";

        select.appendChild(option);

    });

}