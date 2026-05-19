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
        this.preview_timer = null;
        this.created_invoice = null;
        this.preview = null;
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
                .si-cart input, .si-payment-box input, .si-discount-box input { background:#0f172a; border:1px solid #334155; color:#fff; border-radius:10px; padding:7px; width:100%; }
                .si-remove { border:0; background:#ef4444; color:#fff; border-radius:10px; height:32px; width:32px; font-weight:900; }
                .si-payment-box, .si-discount-box { margin-top:14px; padding:14px; border-radius:18px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); }
                .si-pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
                .si-pay-label { font-size:11px; font-weight:900; color:#cbd5e1; margin-bottom:5px; text-transform:uppercase; }
                .si-payment-box select { background:#0f172a; border:1px solid #334155; color:#fff; border-radius:10px; padding:7px; width:100%; }
                .si-totals { border-top:1px solid rgba(255,255,255,.12); margin-top:14px; padding-top:14px; }
                .si-total-line { display:flex; justify-content:space-between; margin:8px 0; color:#cbd5e1; }
                .si-grand { color:#86efac; font-size:26px; font-weight:950; }
                .si-tax-note { color:#fbbf24; font-size:12px; font-weight:800; margin-top:6px; }
                .si-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; }
                .si-actions-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:10px; }
                .si-btn { border:0; border-radius:16px; padding:13px 14px; font-weight:900; }
                .si-btn-primary { background:linear-gradient(90deg,#10b981,#14b8a6); color:#fff; }
                .si-btn-blue { background:linear-gradient(90deg,#2563eb,#7c3aed); color:#fff; }
                .si-btn-purple { background:linear-gradient(90deg,#9333ea,#db2777); color:#fff; }
                .si-btn-light { background:#e2e8f0; color:#0f172a; }
                .si-empty { padding:24px; text-align:center; color:#94a3b8; border:1px dashed #334155; border-radius:18px; }
                @media (max-width: 1100px) { .si-pos-grid { grid-template-columns:1fr; } .si-results { grid-template-columns:repeat(2,1fr); } .si-field-grid { grid-template-columns:repeat(2,1fr); } }
                @media (max-width: 700px) { .si-results, .si-field-grid, .si-pay-grid, .si-actions, .si-actions-3 { grid-template-columns:1fr; } }
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
                                <div class="si-tax-note">Discount is applied on Grand Total. Amount discount has priority over %.</div>
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
                                <div class="si-total-line" style="margin-top:10px;"><span>Paid</span><span class="si-paid-total">OMR 0.000</span></div>
                                <div class="si-total-line"><span>Balance</span><span class="si-balance-total">OMR 0.000</span></div>
                            </div>

                            <div class="si-totals">
                                <div class="si-total-line"><span>Items</span><span class="si-total-items">0</span></div>
                                <div class="si-total-line"><span>Gross Total Incl. VAT</span><span class="si-subtotal">OMR 0.000</span></div>
                                <div class="si-total-line"><span>Discount</span><span class="si-discount-total">OMR 0.000</span></div>
                                <div class="si-total-line"><span>VAT 5% Included</span><span class="si-vat-total">OMR 0.000</span></div>
                                <div class="si-total-line"><span>Rounding</span><span class="si-rounding-total">OMR 0.000</span></div>
                                <div class="si-total-line si-grand"><span>Payable</span><span class="si-grand-total">OMR 0.000</span></div>
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
            const r = await frappe.call({ method: "si_pos.api.si_pos.get_defaults" });
            this.defaults = r.message || {};
            this.currency = this.defaults.currency || "OMR";
            if (this.defaults.company) this.company_field.set_value(this.defaults.company);
            if (this.defaults.price_list) this.price_list_field.set_value(this.defaults.price_list);
            this.render_payment_modes(this.defaults.payment_modes || []);
            this.render_cart();
        } catch (e) {
            frappe.msgprint("Unable to load SI POS defaults. Check Sales Invoice permissions.");
        }
    }

    render_payment_modes(modes) {
        const options = (modes || []).map(m => `<option value="${frappe.utils.escape_html(m.name)}">${frappe.utils.escape_html(m.name)}</option>`).join("");
        this.wrapper.find(".si-cash-mode, .si-card-mode").html(options);
        if (this.defaults.cash_mode) this.wrapper.find(".si-cash-mode").val(this.defaults.cash_mode);
        if (this.defaults.card_mode) this.wrapper.find(".si-card-mode").val(this.defaults.card_mode);
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

    fill_cash_balance() {
        const payable = this.get_payable_total();
        const card_amount = flt(this.wrapper.find(".si-card-amount").val());
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
                <div style="text-align:right; margin-top:8px; font-weight:900; color:#86efac;">${this.format_currency(flt(row.qty) * flt(row.rate))}</div>
            </div>`).join(""));

        const total_qty = this.cart.reduce((sum, row) => sum + flt(row.qty), 0);
        const gross = this.get_subtotal();
        const payable = this.get_payable_total();
        const paid = this.get_payments().reduce((sum, row) => sum + flt(row.amount), 0);
        const balance = payable - paid;
        const discount = this.preview ? flt(this.preview.discount_amount) : Math.max(gross - payable, 0);
        const vat = this.preview ? flt(this.preview.total_taxes_and_charges) : 0;
        const rounding = this.preview ? flt(this.preview.rounding_adjustment) : 0;

        this.wrapper.find(".si-total-items").text(total_qty);
        this.wrapper.find(".si-subtotal").text(this.format_currency(gross));
        this.wrapper.find(".si-discount-total").text(this.format_currency(discount));
        this.wrapper.find(".si-vat-total").text(this.format_currency(vat));
        this.wrapper.find(".si-rounding-total").text(this.format_currency(rounding));
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
            this.created_invoice = r.message;
            frappe.show_alert({ message: `Draft Sales Invoice ${this.created_invoice.name} created`, indicator: "green" });
        } catch (e) { frappe.msgprint("Draft Sales Invoice creation failed. Check VAT account, setup, and permissions."); }
    }

    async submit_and_print() {
        if (!this.validate_before_action()) return;
        try {
            const r = await frappe.call({ method: "si_pos.api.si_pos.create_and_submit_sales_invoice", freeze: true, freeze_message: "Submitting Sales Invoice...", args: this.common_args() });
            this.created_invoice = r.message;
            frappe.show_alert({ message: `Sales Invoice ${this.created_invoice.name} submitted`, indicator: "green" });
            this.open_print();
        } catch (e) { frappe.msgprint("Submit failed. Check VAT account, stock, accounts, taxes, and permissions."); }
    }

    async submit_pay_and_print() {
        if (!this.validate_before_action()) return;
        await this.preview_totals();
        if (this.get_payments().length === 0) this.fill_cash_balance();
        const payable = this.get_payable_total();
        const paid = this.get_payments().reduce((sum, row) => sum + flt(row.amount), 0);
        if (Math.abs(payable - paid) > 0.001) return frappe.msgprint("Paid amount must match the final payable total before Submit Pay & Print.");
        try {
            const args = this.common_args();
            args.payments = this.get_payments();
            const r = await frappe.call({ method: "si_pos.api.si_pos.create_paid_sales_invoice", freeze: true, freeze_message: "Submitting Paid Sales Invoice...", args });
            this.created_invoice = r.message;
            const pe_text = (this.created_invoice.payment_entries || []).length ? ` Payment Entry: ${(this.created_invoice.payment_entries || []).join(", ")}` : "";
            frappe.show_alert({ message: `Paid Sales Invoice ${this.created_invoice.name} submitted.${pe_text}`, indicator: "green" });
            this.open_print();
        } catch (e) { frappe.msgprint("Paid invoice failed. Check VAT account, Mode of Payment accounts, and invoice setup."); }
    }

    open_invoice() {
        if (this.created_invoice && this.created_invoice.name) frappe.set_route("Form", "Sales Invoice", this.created_invoice.name);
        else frappe.msgprint("No invoice created yet.");
    }

    open_print() {
        if (!this.created_invoice || !this.created_invoice.name) return;
        const url = `/app/print/Sales%20Invoice/${encodeURIComponent(this.created_invoice.name)}`;
        window.open(url, "_blank");
    }

    format_currency(value) {
        return `${this.currency} ${format_number(flt(value), null, 3)}`;
    }
}
