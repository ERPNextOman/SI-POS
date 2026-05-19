frappe.pages["si-pos"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: "",
        single_column: true,
    });

    if (page.set_title) page.set_title("");
    new SIPOSPage(page);
};

class SIPOSPage {
    constructor(page) {
        this.page = page;
        this.wrapper = $(page.main);
        this.cart = [];
        this.currency = "OMR";
        this.defaults = {};
        this.pos_config = {};
        this.search_timer = null;
        this.preview_timer = null;
        this.created_invoice = null;
        this.last_invoice = null;
        this.preview = null;
        this.storage_key = "si_pos_held_carts_v1";

        window.si_pos_current_instance = this;
        try { this.wrapper.closest(".page-wrapper").data("si_pos_instance", this); } catch (e) {}

        this.prepare_page_layout();
        this.make();
        this.load_defaults();
    }

    prepare_page_layout() {
        const $page_container = this.wrapper.closest(".page-container");
        const $main_wrapper = this.wrapper.closest(".layout-main-section-wrapper");
        const $main_section = this.wrapper.closest(".layout-main-section");

        $page_container.addClass("si-pos-full-page");
        $main_wrapper.css({ "max-width": "none", "width": "100%", "padding": "0" });
        $main_section.css({ "max-width": "none", "width": "100%" });

        if (!document.getElementById("si-pos-desk-layout-style")) {
            $("head").append(`
                <style id="si-pos-desk-layout-style">
                    .si-pos-full-page .page-head,
                    .si-pos-full-page .page-title,
                    .si-pos-full-page .page-title-area,
                    .si-pos-full-page .standard-actions,
                    .si-pos-full-page .custom-actions { display: none !important; }
                    .si-pos-full-page .page-content { padding: 0 8px 8px 8px !important; }
                    .si-pos-full-page .layout-main-section-wrapper,
                    .si-pos-full-page .layout-main-section,
                    .si-pos-full-page .container,
                    .si-pos-full-page .page-body { max-width: none !important; width: 100% !important; }
                    .si-pos-full-page .layout-main-section { padding: 0 !important; }
                </style>
            `);
        }
    }

    make() {
        this.wrapper.html(`
            <style>
                .si-pos-wrap { background: linear-gradient(135deg,#eef2ff,#fdf2f8,#ecfeff); min-height: calc(100vh - 72px); padding: 10px; border-radius: 14px; }
                .si-pos-head { background: linear-gradient(90deg,#4338ca,#7c3aed,#db2777); color:#fff; border-radius:18px; padding:14px 18px; margin-bottom:10px; box-shadow:0 10px 24px rgba(79,70,229,.18); }
                .si-pos-title { font-size:22px; font-weight:900; margin:0; letter-spacing:.5px; }
                .si-pos-sub { opacity:.88; margin-top:3px; font-size:13px; }
                .si-pos-grid { display:grid; grid-template-columns:1.18fr .82fr; gap:12px; align-items:start; }
                .si-card { background:#fff; border-radius:18px; padding:12px; box-shadow:0 8px 18px rgba(15,23,42,.06); border:1px solid rgba(226,232,240,.85); }
                .si-field-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
                .si-field-grid .form-group, .si-search .form-group { margin-bottom:0 !important; }
                .si-field-grid .control-label, .si-search .control-label { font-size:12px; margin-bottom:4px; }
                .si-field-grid input, .si-field-grid .form-control, .si-search input { min-height:32px !important; height:32px !important; padding:5px 10px !important; border-radius:9px !important; }
                .si-search-row { display:flex; gap:8px; align-items:end; }
                .si-search-row .form-group { margin-bottom:0; flex:1; }
                .si-search-btn { height:32px; padding:5px 14px !important; border-radius:9px !important; background:#020617 !important; border-color:#020617 !important; }
                .si-results { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:10px; }
                .si-item { cursor:pointer; overflow:hidden; border-radius:14px; border:1px solid #e2e8f0; background:#fff; transition:.15s ease; }
                .si-item:hover { transform:translateY(-1px); box-shadow:0 10px 20px rgba(15,23,42,.10); }
                .si-item-top { padding:12px; color:#fff; background:linear-gradient(135deg,#0ea5e9,#6366f1); min-height:76px; }
                .si-item:nth-child(2n) .si-item-top { background:linear-gradient(135deg,#ec4899,#f97316); }
                .si-item:nth-child(3n) .si-item-top { background:linear-gradient(135deg,#10b981,#14b8a6); }
                .si-item-code { font-size:10px; opacity:.9; font-weight:800; }
                .si-item-name { margin-top:16px; font-size:14px; line-height:1.15; font-weight:900; }
                .si-item-bottom { padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
                .si-price { font-weight:900; color:#0f172a; font-size:13px; }
                .si-tag { font-size:10px; padding:3px 7px; border-radius:999px; background:#f1f5f9; color:#475569; font-weight:800; }
                .si-cart { background:#020617; color:#fff; border-radius:18px; padding:12px; box-shadow:0 14px 28px rgba(2,6,23,.20); }
                .si-cart-title { font-size:20px; font-weight:900; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; }
                .si-pill { background:#10b981; color:#fff; border-radius:999px; padding:5px 10px; font-size:10px; font-weight:900; }
                .si-cart-row { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); border-radius:13px; padding:10px; margin-bottom:8px; }
                .si-cart-line { display:grid; grid-template-columns:1fr 64px 74px 30px; gap:7px; align-items:center; }
                .si-cart-name { font-weight:850; font-size:13px; }
                .si-cart-code { font-size:10px; color:#94a3b8; margin-top:2px; }
                .si-cart input, .si-payment-box input, .si-discount-box input { background:#0f172a; border:1px solid #334155; color:#fff; border-radius:9px; padding:6px 7px; width:100%; height:32px; }
                .si-remove { border:0; background:#ef4444; color:#fff; border-radius:9px; height:30px; width:30px; font-weight:900; }
                .si-payment-box, .si-discount-box { margin-top:10px; padding:10px; border-radius:14px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); }
                .si-pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
                .si-pay-label { font-size:10px; font-weight:900; color:#cbd5e1; margin-bottom:4px; text-transform:uppercase; }
                .si-payment-box select { background:#0f172a; border:1px solid #334155; color:#fff; border-radius:9px; padding:6px 7px; width:100%; height:32px; }
                .si-pay-quick, .si-hold-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px; }
                .si-quick-btn { border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.10); color:#fff; border-radius:10px; padding:7px 8px; font-size:11px; font-weight:900; }
                .si-quick-btn:hover { background:rgba(255,255,255,.18); }
                .si-totals { border-top:1px solid rgba(255,255,255,.12); margin-top:10px; padding-top:10px; }
                .si-total-line { display:flex; justify-content:space-between; margin:6px 0; color:#cbd5e1; font-size:13px; }
                .si-grand { color:#86efac; font-size:22px; font-weight:950; }
                .si-tax-note { color:#fbbf24; font-size:11px; font-weight:800; margin-top:5px; line-height:1.3; }
                .si-success-box { display:none; margin-top:10px; padding:10px; border-radius:14px; background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.35); }
                .si-success-title { color:#86efac; font-size:12px; font-weight:900; margin-bottom:6px; }
                .si-success-content { color:#d1fae5; font-size:12px; line-height:1.45; }
                .si-success-content a { color:#93c5fd; font-weight:900; text-decoration:none; }
                .si-success-content a:hover { text-decoration:underline; }
                .si-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
                .si-actions-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:8px; }
                .si-btn { border:0; border-radius:13px; padding:10px 10px; font-weight:900; font-size:12px; min-height:42px; }
                .si-btn-primary { background:linear-gradient(90deg,#10b981,#14b8a6); color:#fff; }
                .si-btn-blue { background:linear-gradient(90deg,#2563eb,#7c3aed); color:#fff; }
                .si-btn-purple { background:linear-gradient(90deg,#9333ea,#db2777); color:#fff; }
                .si-btn-light { background:#e2e8f0; color:#0f172a; }
                .si-empty { padding:18px; text-align:center; color:#94a3b8; border:1px dashed #334155; border-radius:14px; }
                .si-held-row { display:grid; grid-template-columns:1fr auto auto; gap:8px; align-items:center; padding:10px; border:1px solid #e5e7eb; border-radius:10px; margin-bottom:8px; }
                @media (max-width: 1300px) { .si-results { grid-template-columns:repeat(3,1fr); } }
                @media (max-width: 1100px) { .si-pos-grid { grid-template-columns:1fr; } .si-results { grid-template-columns:repeat(3,1fr); } .si-field-grid { grid-template-columns:repeat(2,1fr); } }
                @media (max-width: 700px) { .si-results, .si-field-grid, .si-pay-grid, .si-actions, .si-actions-3, .si-pay-quick, .si-hold-grid { grid-template-columns:1fr; } }
            </style>
            <div class="si-pos-wrap">
                <div class="si-pos-head">
                    <div class="si-pos-title">SI POS</div>
                    <div class="si-pos-sub">Prices are VAT-inclusive. Fixed VAT: 5%</div>
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

                        <div class="si-card" style="margin-top:10px;">
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
                                <span class="si-pill">VAT Included</span>
                            </div>
                            <div class="si-cart-list"></div>

                            <div class="si-discount-box">
                                <div class="si-pay-grid">
                                    <div>
                                        <div class="si-pay-label">Discount %</div>
                                        <input class="si-discount-percent" type="number" step="0.001" value="0">
                                    </div>
                                    <div>
                                        <div class="si-pay-label">Discount Amount</div>
                                        <input class="si-discount-amount" type="number" step="0.001" value="0">
                                    </div>
                                </div>
                                <div class="si-tax-note">Amount discount has priority over %.</div>
                            </div>

                            <div class="si-payment-box">
                                <div class="si-pay-grid">
                                    <div>
                                        <div class="si-pay-label">Cash Mode</div>
                                        <select class="si-cash-mode"></select>
                                    </div>
                                    <div>
                                        <div class="si-pay-label">Cash Amount</div>
                                        <input class="si-cash-amount" type="number" step="0.001" value="0">
                                    </div>
                                    <div>
                                        <div class="si-pay-label">Card Mode</div>
                                        <select class="si-card-mode"></select>
                                    </div>
                                    <div>
                                        <div class="si-pay-label">Card Amount</div>
                                        <input class="si-card-amount" type="number" step="0.001" value="0">
                                    </div>
                                </div>
                                <div class="si-pay-quick">
                                    <button class="si-quick-btn si-full-cash-btn">Full Cash</button>
                                    <button class="si-quick-btn si-full-card-btn">Full Card</button>
                                </div>
                                <div class="si-total-line" style="margin-top:8px;"><span>Paid</span><span class="si-paid-total">OMR 0.000</span></div>
                                <div class="si-total-line"><span>Balance</span><span class="si-balance-total">OMR 0.000</span></div>
                            </div>

                            <div class="si-totals">
                                <div class="si-total-line"><span>Items</span><span class="si-total-items">0</span></div>
                                <div class="si-total-line"><span>Gross Total Incl. VAT</span><span class="si-subtotal">OMR 0.000</span></div>
                                <div class="si-total-line"><span>Discount</span><span class="si-discount-total">OMR 0.000</span></div>
                                <div class="si-total-line"><span>VAT <span class="si-vat-rate-label">5</span>% Included</span><span class="si-vat-total">OMR 0.000</span></div>
                                <div class="si-total-line si-grand"><span>Payable</span><span class="si-grand-total">OMR 0.000</span></div>
                            </div>
                            <div class="si-hold-grid">
                                <button class="si-quick-btn si-hold-btn">Hold Cart</button>
                                <button class="si-quick-btn si-resume-btn">Resume Cart</button>
                            </div>
                            <div class="si-actions">
                                <button class="si-btn si-btn-light si-clear-btn">Clear</button>
                                <button class="si-btn si-btn-primary si-create-btn">Create Draft</button>
                            </div>
                            <div class="si-actions-3">
                                <button class="si-btn si-btn-blue si-submit-print-btn">Submit & Print</button>
                                <button class="si-btn si-btn-purple si-submit-pay-print-btn">Submit Pay & Print</button>
                                <button class="si-btn si-btn-light si-open-btn">Open SI</button>
                            </div>
                            <div class="si-success-box">
                                <div class="si-success-title">Last Transaction</div>
                                <div class="si-success-content"></div>
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
        this.company_field = frappe.ui.form.make_control({ parent: this.wrapper.find(".si-company"), df: { fieldtype: "Link", options: "Company", label: "Company", fieldname: "company", reqd: 1 }, render_input: true });
        this.customer_field = frappe.ui.form.make_control({ parent: this.wrapper.find(".si-customer"), df: { fieldtype: "Link", options: "Customer", label: "Customer", fieldname: "customer", reqd: 1 }, render_input: true });
        this.price_list_field = frappe.ui.form.make_control({ parent: this.wrapper.find(".si-price-list"), df: { fieldtype: "Link", options: "Price List", label: "Price List", fieldname: "price_list" }, render_input: true });
        this.warehouse_field = frappe.ui.form.make_control({ parent: this.wrapper.find(".si-warehouse"), df: { fieldtype: "Link", options: "Warehouse", label: "Warehouse", fieldname: "warehouse" }, render_input: true });
        this.search_field = frappe.ui.form.make_control({ parent: this.wrapper.find(".si-search"), df: { fieldtype: "Data", label: "Search Item / Barcode / Part No", fieldname: "search" }, render_input: true });
    }

    bind_events() {
        this.wrapper.on("click", ".si-search-btn", () => this.search_items());
        this.wrapper.on("click", ".si-clear-btn", () => this.clear_cart());
        this.wrapper.on("click", ".si-create-btn", () => this.create_invoice());
        this.wrapper.on("click", ".si-submit-print-btn", () => this.submit_and_print());
        this.wrapper.on("click", ".si-submit-pay-print-btn", () => this.submit_pay_and_print());
        this.wrapper.on("click", ".si-open-btn", () => this.open_invoice());
        this.wrapper.on("click", ".si-full-cash-btn", () => this.full_cash());
        this.wrapper.on("click", ".si-full-card-btn", () => this.full_card());
        this.wrapper.on("click", ".si-hold-btn", () => this.hold_cart());
        this.wrapper.on("click", ".si-resume-btn", () => this.show_resume_dialog());
        this.wrapper.on("change keyup", ".si-cash-amount, .si-card-amount", () => this.render_cart());
        this.wrapper.on("change keyup", ".si-discount-percent, .si-discount-amount", () => this.schedule_preview());

        this.wrapper.on("keyup", "input[data-fieldname='search']", (e) => {
            if (e.key === "Enter") return this.search_items();
            clearTimeout(this.search_timer);
            this.search_timer = setTimeout(() => this.search_items(), 350);
        });

        this.wrapper.on("click", ".si-item", (e) => this.add_item($(e.currentTarget).attr("data-item-code")));

        this.wrapper.on("change", ".si-qty, .si-rate", (e) => {
            const idx = cint($(e.currentTarget).closest(".si-cart-row").attr("data-idx"));
            const row = this.cart[idx];
            if (!row) return;
            row.qty = flt(this.wrapper.find(`.si-cart-row[data-idx='${idx}'] .si-qty`).val());
            row.rate = flt(this.wrapper.find(`.si-cart-row[data-idx='${idx}'] .si-rate`).val());
            if (row.qty <= 0) row.qty = 1;
            if (row.rate < 0) row.rate = 0;
            this.schedule_preview();
        });

        this.wrapper.on("click", ".si-remove", (e) => {
            const idx = cint($(e.currentTarget).closest(".si-cart-row").attr("data-idx"));
            this.cart.splice(idx, 1);
            this.schedule_preview();
        });
    }

    async load_defaults() {
        try {
            const [defaults_response, config_response] = await Promise.all([
                frappe.call({ method: "si_pos.api.si_pos.get_defaults" }),
                frappe.call({ method: "si_pos.api.pos_config.get_pos_config" }).catch(() => ({ message: {} })),
            ]);

            this.defaults = defaults_response.message || {};
            this.pos_config = config_response.message || {};
            this.currency = this.defaults.currency || "OMR";

            const company = this.pos_config.default_company || this.defaults.company;
            const customer = this.pos_config.default_customer || this.defaults.customer;
            const price_list = this.pos_config.default_price_list || this.defaults.price_list;
            const warehouse = this.pos_config.default_warehouse || this.defaults.warehouse;

            if (company) this.company_field.set_value(company);
            if (customer) this.customer_field.set_value(customer);
            if (price_list) this.price_list_field.set_value(price_list);
            if (warehouse) this.warehouse_field.set_value(warehouse);

            this.render_payment_modes(this.defaults.payment_modes || []);
            this.apply_pos_settings_to_ui();
            this.render_cart();
        } catch (e) {
            frappe.msgprint("Unable to load SI POS defaults. Check Sales Invoice permissions.");
        }
    }

    apply_pos_settings_to_ui() {
        const vat_rate = flt(this.pos_config.vat_rate || this.defaults.vat_rate || 5);
        const inclusive = cint(this.pos_config.vat_inclusive !== undefined ? this.pos_config.vat_inclusive : this.defaults.vat_inclusive);
        this.wrapper.find(".si-vat-rate-label").text(format_number(vat_rate, null, 2).replace(/\.00$/, ""));
        this.wrapper.find(".si-pos-sub").text(`Prices are ${inclusive ? "VAT-inclusive" : "VAT-exclusive"}. VAT: ${format_number(vat_rate, null, 2).replace(/\.00$/, "")}%`);

        const default_pf = this.pos_config.default_print_format || this.defaults.default_print_format;
        if (default_pf) {
            setTimeout(() => $(".si-extra-print-format").val(default_pf), 700);
        }
    }

    render_payment_modes(modes) {
        const options = (modes || []).map(m => `<option value="${frappe.utils.escape_html(m.name)}">${frappe.utils.escape_html(m.name)}</option>`).join("");
        this.wrapper.find(".si-cash-mode, .si-card-mode").html(options);

        const cash_mode = this.pos_config.default_cash_mode || this.defaults.cash_mode;
        const card_mode = this.pos_config.default_card_mode || this.defaults.card_mode;
        if (cash_mode) this.wrapper.find(".si-cash-mode").val(cash_mode);
        if (card_mode) this.wrapper.find(".si-card-mode").val(card_mode);
    }

    async search_items() {
        const txt = this.search_field.get_value();
        if (!txt) return this.wrapper.find(".si-results").html(`<div class="text-muted">Type item name, code, barcode, or part number.</div>`);
        this.wrapper.find(".si-results").html(`<div class="text-muted">Searching...</div>`);
        try {
            const r = await frappe.call({ method: "si_pos.api.si_pos.search_items", args: { txt, price_list: this.price_list_field.get_value(), warehouse: this.warehouse_field.get_value(), limit: 24 } });
            this.render_results(r.message || []);
        } catch (e) {
            this.wrapper.find(".si-results").html(`<div class="text-danger">Search failed.</div>`);
        }
    }

    render_results(items) {
        if (!items.length) return this.wrapper.find(".si-results").html(`<div class="text-muted">No items found.</div>`);
        this.wrapper.find(".si-results").html(items.map((item) => `
            <div class="si-item" data-item-code="${frappe.utils.escape_html(item.item_code)}">
                <div class="si-item-top"><div class="si-item-code">${frappe.utils.escape_html(item.item_code)}</div><div class="si-item-name">${frappe.utils.escape_html(item.item_name || item.item_code)}</div></div>
                <div class="si-item-bottom"><span class="si-price">${this.format_currency(item.rate || 0)}</span><span class="si-tag">${frappe.utils.escape_html(item.uom || "Nos")}</span></div>
            </div>`).join(""));
    }

    async add_item(item_code) {
        try {
            const r = await frappe.call({ method: "si_pos.api.si_pos.get_item_details", args: { item_code, price_list: this.price_list_field.get_value(), warehouse: this.warehouse_field.get_value() } });
            const item = r.message;
            const existing = this.cart.find(row => row.item_code === item.item_code);
            if (existing) existing.qty += 1;
            else this.cart.push({ item_code: item.item_code, item_name: item.item_name, uom: item.uom, qty: 1, rate: flt(item.rate || 0) });
            this.schedule_preview();
        } catch (e) {
            frappe.msgprint("Could not add item.");
        }
    }

    get_subtotal() {
        return this.cart.reduce((sum, row) => sum + (flt(row.qty) * flt(row.rate)), 0);
    }

    get_discount_args() {
        const discount_amount = flt(this.wrapper.find(".si-discount-amount").val());
        const discount_percentage = discount_amount > 0 ? 0 : flt(this.wrapper.find(".si-discount-percent").val());
        return { discount_amount, discount_percentage };
    }

    get_payable_total() {
        if (this.preview && this.preview.payable_total !== undefined) return flt(this.preview.payable_total);
        const d = this.get_discount_args();
        let total = this.get_subtotal();
        if (d.discount_amount > 0) total -= d.discount_amount;
        else if (d.discount_percentage > 0) total -= total * d.discount_percentage / 100;
        return Math.max(total, 0);
    }

    get_payments() {
        const payments = [];
        const cash_amount = flt(this.wrapper.find(".si-cash-amount").val());
        const card_amount = flt(this.wrapper.find(".si-card-amount").val());
        const cash_mode = this.wrapper.find(".si-cash-mode").val();
        const card_mode = this.wrapper.find(".si-card-mode").val();
        if (cash_amount > 0) payments.push({ mode_of_payment: cash_mode, amount: cash_amount });
        if (card_amount > 0) payments.push({ mode_of_payment: card_mode, amount: card_amount });
        return payments;
    }

    full_cash() {
        const payable = this.get_payable_total();
        this.wrapper.find(".si-card-amount").val(0);
        this.wrapper.find(".si-cash-amount").val(flt(payable, 3));
        this.render_cart();
    }

    full_card() {
        const payable = this.get_payable_total();
        this.wrapper.find(".si-cash-amount").val(0);
        this.wrapper.find(".si-card-amount").val(flt(payable, 3));
        this.render_cart();
    }

    fill_cash_balance() {
        const payable = this.get_payable_total();
        let card_amount = flt(this.wrapper.find(".si-card-amount").val());
        if (card_amount > payable) {
            card_amount = payable;
            this.wrapper.find(".si-card-amount").val(flt(card_amount, 3));
        }
        const cash_needed = Math.max(payable - card_amount, 0);
        this.wrapper.find(".si-cash-amount").val(flt(cash_needed, 3));
        this.render_cart();
    }

    schedule_preview() {
        this.render_cart();
        clearTimeout(this.preview_timer);
        this.preview_timer = setTimeout(() => this.preview_totals(), 350);
    }

    async preview_totals() {
        if (!this.company_field.get_value() || !this.customer_field.get_value() || !this.cart.length) return;
        try {
            const args = this.common_args();
            const r = await frappe.call({ method: "si_pos.api.si_pos.preview_sales_invoice", args });
            this.preview = r.message || null;
            this.render_cart();
        } catch (e) {
            this.preview = null;
            this.render_cart();
        }
    }

    render_cart() {
        const list = this.wrapper.find(".si-cart-list");
        if (!this.cart.length) list.html(`<div class="si-empty">Cart is empty. Search and add items.</div>`);
        else list.html(this.cart.map((row, idx) => `
            <div class="si-cart-row" data-idx="${idx}">
                <div class="si-cart-line">
                    <div><div class="si-cart-name">${frappe.utils.escape_html(row.item_name || row.item_code)}</div><div class="si-cart-code">${frappe.utils.escape_html(row.item_code)} | ${frappe.utils.escape_html(row.uom || "")}</div></div>
                    <input class="si-qty" type="number" step="0.001" value="${flt(row.qty)}">
                    <input class="si-rate" type="number" step="0.001" value="${flt(row.rate)}">
                    <button class="si-remove">×</button>
                </div>
                <div style="text-align:right; margin-top:6px; font-weight:900; color:#86efac; font-size:13px;">${this.format_currency(flt(row.qty) * flt(row.rate))}</div>
            </div>`).join(""));

        const total_qty = this.cart.reduce((sum, row) => sum + flt(row.qty), 0);
        const gross = this.get_subtotal();
        const payable = this.get_payable_total();
        const paid = this.get_payments().reduce((sum, row) => sum + flt(row.amount), 0);
        const balance = payable - paid;
        const discount = this.preview ? flt(this.preview.discount_amount) : Math.max(gross - payable, 0);
        const vat = this.preview ? flt(this.preview.total_taxes_and_charges) : 0;

        this.wrapper.find(".si-total-items").text(total_qty);
        this.wrapper.find(".si-subtotal").text(this.format_currency(gross));
        this.wrapper.find(".si-discount-total").text(this.format_currency(discount));
        this.wrapper.find(".si-vat-total").text(this.format_currency(vat));
        this.wrapper.find(".si-grand-total").text(this.format_currency(payable));
        this.wrapper.find(".si-paid-total").text(this.format_currency(paid));
        this.wrapper.find(".si-balance-total").text(this.format_currency(balance));
    }

    clear_cart() {
        this.cart = [];
        this.created_invoice = null;
        this.preview = null;
        this.wrapper.find(".si-cash-amount, .si-card-amount, .si-discount-percent, .si-discount-amount").val(0);
        this.render_cart();
    }

    reset_sale_inputs_after_success() {
        this.cart = [];
        this.preview = null;
        this.wrapper.find(".si-cash-amount, .si-card-amount, .si-discount-percent, .si-discount-amount").val(0);
        this.render_cart();
    }

    should_auto_print() {
        return cint(this.pos_config.auto_print === undefined ? 1 : this.pos_config.auto_print) === 1;
    }

    should_auto_clear_cart() {
        return cint(this.pos_config.auto_clear_cart === undefined ? 1 : this.pos_config.auto_clear_cart) === 1;
    }

    show_success_result(result, status_label) {
        this.created_invoice = result;
        this.last_invoice = result;

        const invoice_name = frappe.utils.escape_html(result.name || "");
        const invoice_link = result.name ? `<a href="/app/sales-invoice/${encodeURIComponent(result.name)}" target="_blank">${invoice_name}</a>` : "";
        const payment_links = (result.payment_entries || []).map((pe) => {
            const safe_pe = frappe.utils.escape_html(pe);
            return `<a href="/app/payment-entry/${encodeURIComponent(pe)}" target="_blank">${safe_pe}</a>`;
        }).join(", ");

        let html = `<div>${frappe.utils.escape_html(status_label)}: ${invoice_link}</div>`;
        if (payment_links) html += `<div>Payment Entry: ${payment_links}</div>`;
        html += `<div style="margin-top:4px; color:#a7f3d0;">${this.should_auto_clear_cart() ? "Ready for next bill." : "Cart is kept because Auto Clear Cart is off."}</div>`;

        this.wrapper.find(".si-success-content").html(html);
        this.wrapper.find(".si-success-box").show();
    }

    validate_before_action() {
        if (!this.company_field.get_value()) { frappe.msgprint("Please select Company."); return false; }
        if (!this.customer_field.get_value()) { frappe.msgprint("Please select Customer."); return false; }
        if (!this.cart.length) { frappe.msgprint("Please add at least one item."); return false; }
        return true;
    }

    common_args() {
        const discount = this.get_discount_args();
        return {
            company: this.company_field.get_value(),
            customer: this.customer_field.get_value(),
            price_list: this.price_list_field.get_value(),
            set_warehouse: this.warehouse_field.get_value(),
            items: this.cart,
            discount_percentage: discount.discount_percentage,
            discount_amount: discount.discount_amount,
        };
    }

    async create_invoice() {
        if (!this.validate_before_action()) return;
        try {
            const r = await frappe.call({ method: "si_pos.api.si_pos.create_sales_invoice", freeze: true, freeze_message: "Creating Draft Sales Invoice...", args: this.common_args() });
            this.show_success_result(r.message, "Draft Sales Invoice created");
            frappe.show_alert({ message: `Draft Sales Invoice ${this.created_invoice.name} created`, indicator: "green" });
        } catch (e) { frappe.msgprint("Draft Sales Invoice creation failed. Check VAT account, setup, and permissions."); }
    }

    async submit_and_print() {
        if (!this.validate_before_action()) return;
        try {
            const r = await frappe.call({ method: "si_pos.api.si_pos.create_and_submit_sales_invoice", freeze: true, freeze_message: "Submitting Sales Invoice...", args: this.common_args() });
            this.show_success_result(r.message, "Sales Invoice submitted");
            frappe.show_alert({ message: `Sales Invoice ${this.created_invoice.name} submitted`, indicator: "green" });
            if (this.should_auto_print()) this.open_print();
            if (this.should_auto_clear_cart()) this.reset_sale_inputs_after_success();
        } catch (e) { frappe.msgprint("Submit failed. Check VAT account, stock, accounts, taxes, and permissions."); }
    }

    async submit_pay_and_print() {
        if (!this.validate_before_action()) return;
        await this.preview_totals();
        this.fill_cash_balance();

        const payable = this.get_payable_total();
        const paid = this.get_payments().reduce((sum, row) => sum + flt(row.amount), 0);
        if (Math.abs(payable - paid) > 0.001) return frappe.msgprint("Payment amount could not be matched to final payable total. Please check Cash/Card amount.");
        try {
            const args = this.common_args();
            args.payments = this.get_payments();
            const r = await frappe.call({ method: "si_pos.api.si_pos.create_paid_sales_invoice", freeze: true, freeze_message: "Submitting Paid Sales Invoice...", args });
            this.show_success_result(r.message, "Paid Sales Invoice submitted");
            const pe_text = (this.created_invoice.payment_entries || []).length ? ` Payment Entry: ${(this.created_invoice.payment_entries || []).join(", ")}` : "";
            frappe.show_alert({ message: `Paid Sales Invoice ${this.created_invoice.name} submitted.${pe_text}`, indicator: "green" });
            if (this.should_auto_print()) this.open_print();
            if (this.should_auto_clear_cart()) this.reset_sale_inputs_after_success();
        } catch (e) { frappe.msgprint("Paid invoice failed. Check VAT account, Mode of Payment accounts, and invoice setup."); }
    }

    open_invoice() {
        const target = this.created_invoice || this.last_invoice;
        if (target && target.name) frappe.set_route("Form", "Sales Invoice", target.name);
        else frappe.msgprint("No invoice created yet.");
    }

    selected_print_format() {
        return $(".si-extra-print-format").val() || this.pos_config.default_print_format || this.defaults.default_print_format || "";
    }

    open_print() {
        const target = this.created_invoice || this.last_invoice;
        if (!target || !target.name) return;
        let url = `/app/print/Sales%20Invoice/${encodeURIComponent(target.name)}`;
        const pf = this.selected_print_format();
        if (pf) url += `?format=${encodeURIComponent(pf)}`;
        window.open(url, "_blank");
    }

    format_currency(value) {
        return `${this.currency} ${format_number(flt(value), null, 3)}`;
    }

    get_held_carts() {
        try { return JSON.parse(localStorage.getItem(this.storage_key) || "[]"); }
        catch (e) { return []; }
    }

    save_held_carts(rows) {
        localStorage.setItem(this.storage_key, JSON.stringify(rows || []));
    }

    hold_cart() {
        if (!this.cart.length) return frappe.msgprint("Cart is empty. Add items before holding.");

        const held = this.get_held_carts();
        const d = this.get_discount_args();
        const entry = {
            id: String(Date.now()),
            created_at: frappe.datetime.now_datetime(),
            customer: this.customer_field.get_value(),
            company: this.company_field.get_value(),
            price_list: this.price_list_field.get_value(),
            warehouse: this.warehouse_field.get_value(),
            cart: this.cart,
            discount_percentage: d.discount_percentage,
            discount_amount: d.discount_amount,
            cash_amount: flt(this.wrapper.find(".si-cash-amount").val()),
            card_amount: flt(this.wrapper.find(".si-card-amount").val()),
            total: this.get_payable_total(),
        };
        held.unshift(entry);
        this.save_held_carts(held.slice(0, 30));
        this.clear_cart();
        frappe.show_alert({ message: "Cart held successfully", indicator: "green" });
    }

    show_resume_dialog() {
        const rows = this.get_held_carts();
        if (!rows.length) return frappe.msgprint("No held carts found.");

        const body = rows.map(row => `
            <div class="si-held-row" data-id="${frappe.utils.escape_html(row.id)}">
                <div>
                    <div style="font-weight:900;">${frappe.utils.escape_html(row.customer || "No Customer")}</div>
                    <div class="text-muted">${frappe.utils.escape_html(row.created_at || "")} | ${frappe.utils.escape_html((row.cart || []).length)} item(s) | ${this.format_currency(row.total || 0)}</div>
                </div>
                <button class="btn btn-xs btn-primary si-resume-one" data-id="${frappe.utils.escape_html(row.id)}">Resume</button>
                <button class="btn btn-xs btn-danger si-delete-held" data-id="${frappe.utils.escape_html(row.id)}">Delete</button>
            </div>
        `).join("");

        const d = new frappe.ui.Dialog({
            title: "Resume Held Cart",
            size: "large",
            fields: [{ fieldtype: "HTML", fieldname: "held_html", options: `<div class="si-held-list">${body}</div>` }],
            primary_action_label: "Close",
            primary_action: () => d.hide(),
        });
        d.show();

        d.$wrapper.off("click.si_hold").on("click.si_hold", ".si-resume-one", (e) => {
            this.resume_held_cart($(e.currentTarget).attr("data-id"));
            d.hide();
        });
        d.$wrapper.on("click.si_hold", ".si-delete-held", (e) => {
            this.delete_held_cart($(e.currentTarget).attr("data-id"));
            $(e.currentTarget).closest(".si-held-row").remove();
        });
    }

    resume_held_cart(id) {
        const rows = this.get_held_carts();
        const row = rows.find(r => r.id === id);
        if (!row) return;

        if (row.company) this.company_field.set_value(row.company);
        if (row.customer) this.customer_field.set_value(row.customer);
        if (row.price_list) this.price_list_field.set_value(row.price_list);
        if (row.warehouse) this.warehouse_field.set_value(row.warehouse);
        this.cart = row.cart || [];
        this.wrapper.find(".si-discount-percent").val(flt(row.discount_percentage || 0));
        this.wrapper.find(".si-discount-amount").val(flt(row.discount_amount || 0));
        this.wrapper.find(".si-cash-amount").val(flt(row.cash_amount || 0));
        this.wrapper.find(".si-card-amount").val(flt(row.card_amount || 0));
        this.save_held_carts(rows.filter(r => r.id !== id));
        this.schedule_preview();
        frappe.show_alert({ message: "Held cart resumed", indicator: "green" });
    }

    delete_held_cart(id) {
        const rows = this.get_held_carts().filter(r => r.id !== id);
        this.save_held_carts(rows);
        frappe.show_alert({ message: "Held cart deleted", indicator: "orange" });
    }
}
