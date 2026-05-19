(function () {
    const WAIT_MS = 700;
    const MAX_TRIES = 60;

    function is_si_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function get_pos_instance() {
        const wrap = $('.si-pos-wrap');
        if (!wrap.length) return null;
        return wrap.closest('.page-wrapper').data('si_pos_instance') || window.si_pos_current_instance || null;
    }

    function install_instance_marker() {
        if (!is_si_pos_page()) return;
        if (window.__si_pos_marker_installed) return;
        window.__si_pos_marker_installed = true;

        const original = window.SIPOSPage;
        if (!original) return;

        window.SIPOSPage = class SIPOSPageWithMarker extends original {
            constructor(page) {
                super(page);
                window.si_pos_current_instance = this;
                try {
                    $(page.main).closest('.page-wrapper').data('si_pos_instance', this);
                } catch (e) {}
            }
        };
    }

    function add_controls() {
        if (!is_si_pos_page()) return;
        if ($('.si-pos-extra-controls').length) return;
        if (!$('.si-pos-head').length) return;

        $('.si-pos-head').append(`
            <div class="si-pos-extra-controls" style="margin-top:10px; display:grid; grid-template-columns: minmax(180px, 280px) auto auto; gap:8px; align-items:end;">
                <div>
                    <div style="font-size:10px; font-weight:900; opacity:.85; text-transform:uppercase; margin-bottom:4px;">Print Format</div>
                    <select class="si-extra-print-format" style="height:32px; border:0; border-radius:9px; padding:5px 8px; color:#111827; width:100%;"></select>
                </div>
                <button class="btn btn-light si-extra-customer-btn" style="height:32px; border-radius:9px; font-weight:900;">+ Customer</button>
                <button class="btn btn-light si-extra-closing-btn" style="height:32px; border-radius:9px; font-weight:900;">Daily Closing</button>
            </div>
        `);

        load_print_formats();
        bind_extra_events();
    }

    async function load_print_formats() {
        try {
            const r = await frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Print Format',
                    filters: { doc_type: 'Sales Invoice', disabled: 0 },
                    fields: ['name'],
                    limit_page_length: 100,
                    order_by: 'name asc'
                }
            });
            const rows = r.message || [];
            let html = `<option value="">Default</option>`;
            rows.forEach(row => {
                const name = frappe.utils.escape_html(row.name);
                html += `<option value="${name}">${name}</option>`;
            });
            $('.si-extra-print-format').html(html);

            try {
                const cfg = await frappe.call({ method: 'si_pos.api.pos_config.get_pos_config' });
                if (cfg.message && cfg.message.default_print_format) {
                    $('.si-extra-print-format').val(cfg.message.default_print_format);
                }
                window.si_pos_extra_config = cfg.message || {};
            } catch (e) {}
        } catch (e) {
            $('.si-extra-print-format').html(`<option value="">Default</option>`);
        }
    }

    function bind_extra_events() {
        $(document).off('click.si_pos_extra_customer').on('click.si_pos_extra_customer', '.si-extra-customer-btn', show_customer_dialog);
        $(document).off('click.si_pos_extra_closing').on('click.si_pos_extra_closing', '.si-extra-closing-btn', show_closing_dialog);
    }

    function patch_print_behavior() {
        const inst = get_pos_instance();
        if (!inst || inst.__si_pos_extra_patched) return;
        inst.__si_pos_extra_patched = true;

        const original_open_print = inst.open_print.bind(inst);
        inst.open_print = function () {
            const target = this.created_invoice || this.last_invoice;
            if (!target || !target.name) return;

            const pf = $('.si-extra-print-format').val();
            let url = `/app/print/Sales%20Invoice/${encodeURIComponent(target.name)}`;
            if (pf) url += `?format=${encodeURIComponent(pf)}`;
            window.open(url, '_blank');
        };
    }

    function show_customer_dialog() {
        const d = new frappe.ui.Dialog({
            title: 'Quick Customer Create',
            fields: [
                { fieldtype: 'Data', fieldname: 'customer_name', label: 'Customer Name', reqd: 1 },
                { fieldtype: 'Data', fieldname: 'mobile_no', label: 'Mobile No' },
                { fieldtype: 'Data', fieldname: 'email_id', label: 'Email' }
            ],
            primary_action_label: 'Create Customer',
            primary_action: async (values) => {
                try {
                    const r = await frappe.call({
                        method: 'si_pos.api.pos_actions.quick_create_customer',
                        args: values,
                        freeze: true,
                        freeze_message: 'Creating customer...'
                    });
                    const customer = r.message;
                    const inst = get_pos_instance();
                    if (inst && inst.customer_field) {
                        inst.customer_field.set_value(customer.name);
                    }
                    frappe.show_alert({ message: `Customer ${customer.name} created`, indicator: 'green' });
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Customer creation failed. Check Customer permissions and default Customer Group/Territory.');
                }
            }
        });
        d.show();
    }

    async function show_closing_dialog() {
        const inst = get_pos_instance();
        const company = inst && inst.company_field ? inst.company_field.get_value() : null;

        try {
            const r = await frappe.call({
                method: 'si_pos.api.pos_actions.get_cashier_daily_closing',
                args: { company: company },
                freeze: true,
                freeze_message: 'Loading daily closing...'
            });
            const data = r.message || {};
            const modeRows = Object.entries(data.mode_totals || {}).map(([mode, amount]) => `
                <tr><td>${frappe.utils.escape_html(mode)}</td><td style="text-align:right; font-weight:900;">${format_currency(amount, frappe.defaults.get_default('currency') || 'OMR')}</td></tr>
            `).join('') || `<tr><td colspan="2" class="text-muted">No payment entries found</td></tr>`;

            const invoiceRows = (data.invoices || []).slice(-20).reverse().map(inv => `
                <tr>
                    <td><a href="/app/sales-invoice/${encodeURIComponent(inv.name)}" target="_blank">${frappe.utils.escape_html(inv.name)}</a></td>
                    <td>${frappe.utils.escape_html(inv.customer_name || inv.customer || '')}</td>
                    <td style="text-align:right;">${format_currency(inv.rounded_total || inv.grand_total, frappe.defaults.get_default('currency') || 'OMR')}</td>
                </tr>
            `).join('') || `<tr><td colspan="3" class="text-muted">No invoices today</td></tr>`;

            const html = `
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Invoices</div><div style="font-size:22px; font-weight:900;">${data.invoice_count || 0}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Invoice Total</div><div style="font-size:22px; font-weight:900;">${format_currency(data.invoice_total || 0, frappe.defaults.get_default('currency') || 'OMR')}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Paid Total</div><div style="font-size:22px; font-weight:900;">${format_currency(data.paid_total || 0, frappe.defaults.get_default('currency') || 'OMR')}</div></div>
                </div>
                <h5>Payment Mode Totals</h5>
                <table class="table table-bordered"><tbody>${modeRows}</tbody></table>
                <h5>Latest Invoices</h5>
                <table class="table table-bordered">
                    <thead><tr><th>Invoice</th><th>Customer</th><th style="text-align:right;">Total</th></tr></thead>
                    <tbody>${invoiceRows}</tbody>
                </table>
            `;

            const d = new frappe.ui.Dialog({
                title: `Daily Closing - ${frappe.utils.escape_html(data.posting_date || '')}`,
                size: 'extra-large',
                fields: [{ fieldtype: 'HTML', fieldname: 'summary_html', options: html }],
                primary_action_label: 'Close',
                primary_action: () => d.hide()
            });
            d.show();
        } catch (e) {
            frappe.msgprint('Unable to load daily closing. Check Sales Invoice and Payment Entry permissions.');
        }
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (!is_si_pos_page()) return;
            install_instance_marker();
            add_controls();
            patch_print_behavior();
            tries += 1;
            if (tries >= MAX_TRIES || ($('.si-pos-extra-controls').length && get_pos_instance())) {
                clearInterval(timer);
            }
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
