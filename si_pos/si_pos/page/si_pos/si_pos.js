frappe.pages["si-pos"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: "SI POS",
        single_column: true,
    });

    new SIPOSPage(page);
};

class SIPOSPage {
    constructor(page) {
        this.page = page;
        this.wrapper = $(page.main);
        this.cart = [];
        this.currency = "OMR";
        this.defaults = {};
        this.search_timer = null;
        this.make();
        this.load_defaults();
    }

    make() {
        this.wrapper.html(`
            <style>
                .si-pos-wrap { background: linear-gradient(135deg,#eef2ff,#fdf2f8,#ecfeff); min-height: calc(100vh - 120px); padding: 18px; border-radius: 18px; }
                .si-pos-head { background: linear-gradient(90deg,#4338ca,#7c3aed,#db2777); color:#fff; border-radius:24px; padding:22px; margin-bottom:18px; box-shadow:0 16px 34px rgba(79,70,229,.22); }
                .si-pos-title { font-size:26px; font-weight:900; margin:0; }
                .si-pos-sub { opacity:.88; margin-top:4px; }
                .si-pos-grid { display:grid; grid-template-columns:1.35fr .85fr; gap:18px; }
                .si-card { background:#fff; border-radius:22px; padding:18px; box-shadow:0 10px 24px rgba(15,23,42,.08); border:1px solid rgba(226,232,240,.8); }
                .si-field-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
                .si-label { font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:6px; }
                .si-search-row { display:flex; gap:10px; align-items:end; }
                .si-search-row .form-group { margin-bottom:0; flex:1; }
                .si-results { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:14px; }
                .si-item { cursor:pointer; overflow:hidden; border-radius:20px; border:1px solid #e2e8f0; background:#fff; transition:.15s ease; }
                .si-item:hover { transform:translateY(-2px); box-shadow:0 12px 24px rgba(15,23,42,.12); }
                .si-item-top { padding:16px; color:#fff; background:linear-gradient(135deg,#0ea5e9,#6366f1); min-height:104px; }
                .si-item:nth-child(2n) .si-item-top { background:linear-gradient(135deg,#ec4899,#f97316); }
                .si-item:nth-child(3n) .si-item-top { background:linear-gradient(135deg,#10b981,#14b8a6); }
                .si-item-code { font-size:11px; opacity:.88; font-weight:800; }
                .si-item-name { margin-top:20px; font-size:16px; line-height:1.2; font-weight:900; }
                .si-item-bottom { padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
                .si-price { font-weight:900; color:#0f172a; }
                .si-tag { font-size:11px; padding:4px 8px; border-radius:999px; background:#f1f5f9; color:#475569; font-weight:800; }
                .si-cart { background:#020617; color:#fff; border-radius:24px; padding:18px; box-shadow:0 18px 36px rgba(2,6,23,.22); }
                .si-cart-title { font-size:22px; font-weight:900; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; }
                .si-pill { background:#10b981; color:#fff; border-radius:999px; padding:6px 10px; font-size:11px; font-weight:900; }
                .si-cart-row { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:12px; margin-bottom:10px; }
                .si-cart-line { display:grid; grid-template-columns:1fr 70px 78px 28px; gap:8px; align-items:center; }
                .si-cart-name { font-weight:850; }
                .si-cart-code { font-size:11px; color:#94a3b8; margin-top:3px; }
                .si-cart input { background:#0f172a; border:1px solid #334155; color:#fff; border-radius:10px; padding:7px; width:100%; }
                .si-remove { border:0; background:#ef4444; color:#fff; border-radius:10px; height:32px; width:32px; font-weight:900; }
                .si-totals { border-top:1px solid rgba(255,255,255,.12); margin-top:14px; padding-top:14px; }
                .si-total-line { display:flex; justify-content:space-between; margin:8px 0; color:#cbd5e1; }
                .si-grand { color:#86efac; font-size:26px; font-weight:950; }
                .si-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; }
                .si-btn { border:0; border-radius:16px; padding:13px 14px; font-weight:900; }
                .si-btn-primary { background:linear-gradient(90deg,#10b981,#14b8a6); color:#fff; }
                .si-btn-light { background:#e2e8f0; color:#0f172a; }
                .si-btn-danger { background:#ffe4e6; color:#be123c; }
                .si-empty { padding:24px; text-align:center; color:#94a3b8; border:1px dashed #334155; border-radius:18px; }
                @media (max-width: 1100px) { .si-pos-grid { grid-template-columns:1fr; } .si-results { grid-template-columns:repeat(2,1fr); } .si-field-grid { grid-template-columns:repeat(2,1fr); } }
                @media (max-width: 700px) { .si-results { grid-template-columns:1fr; } .si-field-grid { grid-template-columns:1fr; } }
            </style>
            <div class="si-pos-wrap">
                <div class="si-pos-head">
                    <div class="si-pos-title">SI POS</div>
                    <div class="si-pos-sub">Colorful POS-style billing screen linked to ERPNext Sales Invoice</div>
                </div>

                <div class="si-pos-grid">
                    <div>
                        <div class="si-card">
                            <div class="si-field-grid">
                                <div class="si-company"></div>
                                <div class="si-customer"></div>
                                <div class="si-price-list"></div>
                                <div class="si-warehouse"></div>
                            </div>
                        </div>

                        <div class="si-card" style="margin-top:14px;">
                            <div class="si-search-row">
                                <div class="si-search"></div>
                                <button class="btn btn-primary si-search-btn">Search</button>
                            </div>
                            <div class="si-results"></div>
                        </div>
                    </div>

                    <div>
                        <div class="si-cart">
                            <div class="si-cart-title">
                                <span>Current Sale</span>
                                <span class="si-pill">DRAFT SI</span>
                            </div>
                            <div class="si-cart-list"></div>
                            <div class="si-totals">
                                <div class="si-total-line"><span>Items</span><span class="si-total-items">0</span></div>
                                <div class="si-total-line"><span>Subtotal</span><span class="si-subtotal">OMR 0.000</span></div>
                                <div class="si-total-line si-grand"><span>Total</span><span class="si-grand-total">OMR 0.000</span></div>
                            </div>
                            <div class="si-actions">
                                <button class="si-btn si-btn-light si-clear-btn">Clear</button>
                                <button class="si-btn si-btn-primary si-create-btn">Create Invoice</button>
                            </div>
                            <div class="si-created" style="display:none; margin-top:10px;">
                                <button class="si-btn si-btn-light si-open-btn" style="width:100%;">Open Sales Invoice</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        this.make_fields();
        this.bind_events();
        this.render_cart();
    }

    make_fields() {
        this.company_field = frappe.ui.form.make_control({
            parent: this.wrapper.find(".si-company"),
            df: { fieldtype: "Link", options: "Company", label: "Company", fieldname: "company", reqd: 1 },
            render_input: true,
        });
        this.customer_field = frappe.ui.form.make_control({
            parent: this.wrapper.find(".si-customer"),
            df: { fieldtype: "Link", options: "Customer", label: "Customer", fieldname: "customer", reqd: 1 },
            render_input: true,
        });
        this.price_list_field = frappe.ui.form.make_control({
            parent: this.wrapper.find(".si-price-list"),
            df: { fieldtype: "Link", options: "Price List", label: "Price List", fieldname: "price_list" },
            render_input: true,
        });
        this.warehouse_field = frappe.ui.form.make_control({
            parent: this.wrapper.find(".si-warehouse"),
            df: { fieldtype: "Link", options: "Warehouse", label: "Warehouse", fieldname: "warehouse" },
            render_input: true,
        });
        this.search_field = frappe.ui.form.make_control({
            parent: this.wrapper.find(".si-search"),
            df: { fieldtype: "Data", label: "Search Item / Barcode / Part No", fieldname: "search" },
            render_input: true,
        });
    }

    bind_events() {
        this.wrapper.on("click", ".si-search-btn", () => this.search_items());
        this.wrapper.on("click", ".si-clear-btn", () => this.clear_cart());
        this.wrapper.on("click", ".si-create-btn", () => this.create_invoice());
        this.wrapper.on("click", ".si-open-btn", () => this.open_invoice());

        this.wrapper.on("keyup", "input[data-fieldname='search']", (e) => {
            if (e.key === "Enter") {
                this.search_items();
                return;
            }
            clearTimeout(this.search_timer);
            this.search_timer = setTimeout(() => this.search_items(), 350);
        });

        this.wrapper.on("click", ".si-item", (e) => {
            const item_code = $(e.currentTarget).attr("data-item-code");
            this.add_item(item_code);
        });

        this.wrapper.on("change", ".si-qty, .si-rate", (e) => {
            const idx = cint($(e.currentTarget).closest(".si-cart-row").attr("data-idx"));
            const row = this.cart[idx];
            if (!row) return;
            row.qty = flt(this.wrapper.find(`.si-cart-row[data-idx='${idx}'] .si-qty`).val());
            row.rate = flt(this.wrapper.find(`.si-cart-row[data-idx='${idx}'] .si-rate`).val());
            if (row.qty <= 0) row.qty = 1;
            if (row.rate < 0) row.rate = 0;
            this.render_cart();
        });

        this.wrapper.on("click", ".si-remove", (e) => {
            const idx = cint($(e.currentTarget).closest(".si-cart-row").attr("data-idx"));
            this.cart.splice(idx, 1);
            this.render_cart();
        });
    }

    async load_defaults() {
        try {
            const r = await frappe.call({ method: "si_pos.api.si_pos.get_defaults" });
            this.defaults = r.message || {};
            this.currency = this.defaults.currency || "OMR";
            if (this.defaults.company) this.company_field.set_value(this.defaults.company);
            if (this.defaults.price_list) this.price_list_field.set_value(this.defaults.price_list);
            this.render_cart();
        } catch (e) {
            frappe.msgprint("Unable to load SI POS defaults. Check Sales Invoice permissions.");
        }
    }

    async search_items() {
        const txt = this.search_field.get_value();
        if (!txt) {
            this.wrapper.find(".si-results").html(`<div class="text-muted">Type item name, code, barcode, or part number.</div>`);
            return;
        }

        this.wrapper.find(".si-results").html(`<div class="text-muted">Searching...</div>`);
        try {
            const r = await frappe.call({
                method: "si_pos.api.si_pos.search_items",
                args: {
                    txt: txt,
                    price_list: this.price_list_field.get_value(),
                    warehouse: this.warehouse_field.get_value(),
                    limit: 24,
                },
            });
            this.render_results(r.message || []);
        } catch (e) {
            this.wrapper.find(".si-results").html(`<div class="text-danger">Search failed.</div>`);
        }
    }

    render_results(items) {
        if (!items.length) {
            this.wrapper.find(".si-results").html(`<div class="text-muted">No items found.</div>`);
            return;
        }

        const html = items.map((item) => `
            <div class="si-item" data-item-code="${frappe.utils.escape_html(item.item_code)}">
                <div class="si-item-top">
                    <div class="si-item-code">${frappe.utils.escape_html(item.item_code)}</div>
                    <div class="si-item-name">${frappe.utils.escape_html(item.item_name || item.item_code)}</div>
                </div>
                <div class="si-item-bottom">
                    <span class="si-price">${this.format_currency(item.rate || 0)}</span>
                    <span class="si-tag">${frappe.utils.escape_html(item.uom || "Nos")}</span>
                </div>
            </div>
        `).join("");

        this.wrapper.find(".si-results").html(html);
    }

    async add_item(item_code) {
        try {
            const r = await frappe.call({
                method: "si_pos.api.si_pos.get_item_details",
                args: {
                    item_code: item_code,
                    price_list: this.price_list_field.get_value(),
                    warehouse: this.warehouse_field.get_value(),
                },
            });
            const item = r.message;
            const existing = this.cart.find(row => row.item_code === item.item_code);
            if (existing) {
                existing.qty += 1;
            } else {
                this.cart.push({
                    item_code: item.item_code,
                    item_name: item.item_name,
                    uom: item.uom,
                    qty: 1,
                    rate: flt(item.rate || 0),
                });
            }
            this.render_cart();
        } catch (e) {
            frappe.msgprint("Could not add item.");
        }
    }

    render_cart() {
        const list = this.wrapper.find(".si-cart-list");
        if (!this.cart.length) {
            list.html(`<div class="si-empty">Cart is empty. Search and add items.</div>`);
        } else {
            list.html(this.cart.map((row, idx) => `
                <div class="si-cart-row" data-idx="${idx}">
                    <div class="si-cart-line">
                        <div>
                            <div class="si-cart-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div>
                            <div class="si-cart-code">${frappe.utils.escape_html(row.item_code)} | ${frappe.utils.escape_html(row.uom || "")}</div>
                        </div>
                        <input class="si-qty" type="number" step="0.001" value="${flt(row.qty)}">
                        <input class="si-rate" type="number" step="0.001" value="${flt(row.rate)}">
                        <button class="si-remove">×</button>
                    </div>
                    <div style="text-align:right; margin-top:8px; font-weight:900; color:#86efac;">${this.format_currency(flt(row.qty) * flt(row.rate))}</div>
                </div>
            `).join(""));
        }

        const total_qty = this.cart.reduce((sum, row) => sum + flt(row.qty), 0);
        const subtotal = this.cart.reduce((sum, row) => sum + (flt(row.qty) * flt(row.rate)), 0);
        this.wrapper.find(".si-total-items").text(total_qty);
        this.wrapper.find(".si-subtotal").text(this.format_currency(subtotal));
        this.wrapper.find(".si-grand-total").text(this.format_currency(subtotal));
    }

    clear_cart() {
        this.cart = [];
        this.created_invoice = null;
        this.wrapper.find(".si-created").hide();
        this.render_cart();
    }

    async create_invoice() {
        const customer = this.customer_field.get_value();
        const company = this.company_field.get_value();
        if (!company) return frappe.msgprint("Please select Company.");
        if (!customer) return frappe.msgprint("Please select Customer.");
        if (!this.cart.length) return frappe.msgprint("Please add at least one item.");

        try {
            const r = await frappe.call({
                method: "si_pos.api.si_pos.create_sales_invoice",
                freeze: true,
                freeze_message: "Creating Sales Invoice...",
                args: {
                    company: company,
                    customer: customer,
                    price_list: this.price_list_field.get_value(),
                    set_warehouse: this.warehouse_field.get_value(),
                    items: this.cart,
                },
            });
            this.created_invoice = r.message;
            this.wrapper.find(".si-created").show();
            frappe.show_alert({ message: `Sales Invoice ${this.created_invoice.name} created`, indicator: "green" });
        } catch (e) {
            frappe.msgprint("Sales Invoice creation failed. Check item, price, company, warehouse, and permissions.");
        }
    }

    open_invoice() {
        if (this.created_invoice && this.created_invoice.name) {
            frappe.set_route("Form", "Sales Invoice", this.created_invoice.name);
        }
    }

    format_currency(value) {
        return `${this.currency} ${format_number(flt(value), null, 3)}`;
    }
}
