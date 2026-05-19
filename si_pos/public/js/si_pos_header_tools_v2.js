(function () {
    if (window.__si_pos_header_tools_v3_loaded) return;
    window.__si_pos_header_tools_v3_loaded = true;

    const WAIT_MS = 500;
    const MAX_TRIES = 120;

    function is_si_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function get_pos_instance() {
        return window.si_pos_current_instance || $('.si-pos-wrap').closest('.page-wrapper').data('si_pos_instance') || null;
    }

    function button_html(cls, label) {
        return `<button class="btn btn-light ${cls}" style="height:32px; border-radius:9px; font-weight:900;">${label}</button>`;
    }

    function ensure_header() {
        if (!is_si_pos_page() || !$('.si-pos-head').length) return false;

        $('.si-pos-sub').hide();

        let controls = $('.si-pos-extra-controls');
        if (!controls.length) {
            $('.si-pos-head').append('<div class="si-pos-extra-controls"></div>');
            controls = $('.si-pos-extra-controls');
        }

        controls.css({
            marginTop: '8px',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap'
        });

        controls.find('.si-extra-print-format').closest('div').remove();

        if (!controls.find('.si-extra-customer-btn').length) controls.append(button_html('si-extra-customer-btn', '+ Customer'));
        if (!controls.find('.si-extra-advance-btn').length) controls.append(button_html('si-extra-advance-btn', 'Advance'));
        if (!controls.find('.si-extra-expense-btn').length) controls.append(button_html('si-extra-expense-btn', 'Daily Expense'));
        if (!controls.find('.si-extra-bank-btn').length) controls.append(button_html('si-extra-bank-btn', 'Bank Deposit'));
        if (!controls.find('.si-extra-invoices-btn').length) controls.append(button_html('si-extra-invoices-btn', 'Sales Invoices'));
        if (!controls.find('.si-extra-stock-btn').length) controls.append(button_html('si-extra-stock-btn', 'Available Stock'));
        if (!controls.find('.si-extra-closing-btn').length) controls.append(button_html('si-extra-closing-btn', 'Daily Closing'));

        bind_events();
        return true;
    }

    function bind_events() {
        $(document).off('click.si_pos_v3_customer').on('click.si_pos_v3_customer', '.si-extra-customer-btn', show_customer_dialog);
        $(document).off('click.si_pos_v3_advance').on('click.si_pos_v3_advance', '.si-extra-advance-btn', show_advance_dialog);
        $(document).off('click.si_pos_v3_expense').on('click.si_pos_v3_expense', '.si-extra-expense-btn', show_expense_dialog);
        $(document).off('click.si_pos_v3_bank').on('click.si_pos_v3_bank', '.si-extra-bank-btn', show_bank_deposit_dialog);
        $(document).off('click.si_pos_v3_invoices').on('click.si_pos_v3_invoices', '.si-extra-invoices-btn', show_created_invoices_dialog);
        $(document).off('click.si_pos_v3_stock').on('click.si_pos_v3_stock', '.si-extra-stock-btn', show_available_stock_dialog);
    }

    function current_company() {
        const inst = get_pos_instance();
        return inst && inst.company_field ? inst.company_field.get_value() : null;
    }

    function current_customer() {
        const inst = get_pos_instance();
        return inst && inst.customer_field ? inst.customer_field.get_value() : null;
    }

    function current_warehouse() {
        const inst = get_pos_instance();
        return inst && inst.warehouse_field ? inst.warehouse_field.get_value() : null;
    }

    function current_cash_mode() {
        return $('.si-cash-mode').val() || null;
    }

    function current_card_mode() {
        return $('.si-card-mode').val() || null;
    }

    function set_pos_customer(customer_name) {
        const inst = get_pos_instance();
        if (!inst || !inst.customer_field || !customer_name) return;
        try {
            inst.customer_field.set_value(customer_name);
            setTimeout(() => inst.customer_field.set_value(customer_name), 250);
            setTimeout(() => inst.customer_field.refresh && inst.customer_field.refresh(), 600);
        } catch (e) {}
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
                    const customer = r.message || {};
                    set_pos_customer(customer.name);
                    frappe.show_alert({ message: `Customer ${customer.name} created and selected`, indicator: 'green' });
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Customer creation failed. Check Customer permissions and default Customer Group/Territory.');
                }
            }
        });
        d.show();
    }

    function show_advance_dialog() {
        const d = new frappe.ui.Dialog({
            title: 'Customer Advance',
            fields: [
                { fieldtype: 'Link', fieldname: 'customer', label: 'Customer', options: 'Customer', reqd: 1, default: current_customer() },
                { fieldtype: 'Currency', fieldname: 'amount', label: 'Advance Amount', reqd: 1 },
                { fieldtype: 'Link', fieldname: 'mode_of_payment', label: 'Mode of Payment', options: 'Mode of Payment', default: current_cash_mode() },
                { fieldtype: 'Link', fieldname: 'paid_to', label: 'Paid To Account', options: 'Account', description: 'Optional. Leave blank to use Mode of Payment account.' },
                { fieldtype: 'Data', fieldname: 'reference_no', label: 'Reference No' },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: 'Remarks' }
            ],
            primary_action_label: 'Create Advance',
            primary_action: async (values) => {
                try {
                    const r = await frappe.call({
                        method: 'si_pos.api.cash_control.create_customer_advance',
                        args: { ...values, company: current_company() },
                        freeze: true,
                        freeze_message: 'Creating customer advance...'
                    });
                    const pe = r.message || {};
                    frappe.msgprint({
                        title: 'Advance Created',
                        indicator: 'green',
                        message: `Payment Entry <a href="/app/payment-entry/${encodeURIComponent(pe.name)}" target="_blank">${frappe.utils.escape_html(pe.name)}</a> created.`
                    });
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Advance creation failed. Check Mode of Payment account, customer, and Payment Entry permission.');
                }
            }
        });
        d.show();
    }

    function show_expense_dialog() {
        const d = new frappe.ui.Dialog({
            title: 'Daily Expense',
            fields: [
                { fieldtype: 'Currency', fieldname: 'amount', label: 'Amount', reqd: 1 },
                { fieldtype: 'Data', fieldname: 'purpose', label: 'Purpose', reqd: 1 },
                { fieldtype: 'Link', fieldname: 'mode_of_payment', label: 'Mode of Payment', options: 'Mode of Payment', default: current_cash_mode() },
                { fieldtype: 'Link', fieldname: 'paid_from', label: 'Paid From Account', options: 'Account', description: 'Optional. Leave blank to use Mode of Payment account.' },
                { fieldtype: 'Link', fieldname: 'expense_account', label: 'Expense Account', options: 'Account', description: 'Optional. Leave blank to use default expense account.' },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: 'Remarks' }
            ],
            primary_action_label: 'Create Expense',
            primary_action: async (values) => {
                try {
                    const r = await frappe.call({
                        method: 'si_pos.api.cash_control.create_daily_expense',
                        args: { ...values, company: current_company(), warehouse: current_warehouse() },
                        freeze: true,
                        freeze_message: 'Creating daily expense...'
                    });
                    const doc = r.message || {};
                    frappe.msgprint({
                        title: 'Daily Expense Created',
                        indicator: 'green',
                        message: `Daily Expense <a href="/app/si-pos-daily-expense/${encodeURIComponent(doc.name)}" target="_blank">${frappe.utils.escape_html(doc.name)}</a> created. Journal Entry: <a href="/app/journal-entry/${encodeURIComponent(doc.journal_entry)}" target="_blank">${frappe.utils.escape_html(doc.journal_entry)}</a>`
                    });
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Daily Expense creation failed. Check accounts, permissions, and Mode of Payment setup.');
                }
            }
        });
        d.show();
    }

    function show_bank_deposit_dialog() {
        const d = new frappe.ui.Dialog({
            title: 'Bank Deposit',
            fields: [
                { fieldtype: 'Data', fieldname: 'bank_name', label: 'Bank Name', reqd: 1 },
                { fieldtype: 'Currency', fieldname: 'amount', label: 'Amount', reqd: 1 },
                { fieldtype: 'Link', fieldname: 'from_mode_of_payment', label: 'From Mode of Payment', options: 'Mode of Payment', default: current_cash_mode() },
                { fieldtype: 'Link', fieldname: 'from_account', label: 'From Account', options: 'Account', description: 'Optional. Leave blank to use From Mode of Payment account.' },
                { fieldtype: 'Link', fieldname: 'bank_account', label: 'Bank Account', options: 'Account', description: 'Optional. Leave blank to use first Bank account.' },
                { fieldtype: 'Data', fieldname: 'reference_no', label: 'Reference No' },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: 'Remarks' }
            ],
            primary_action_label: 'Create Bank Deposit',
            primary_action: async (values) => {
                try {
                    const r = await frappe.call({
                        method: 'si_pos.api.cash_control.create_bank_deposit',
                        args: { ...values, company: current_company(), warehouse: current_warehouse() },
                        freeze: true,
                        freeze_message: 'Creating bank deposit...'
                    });
                    const doc = r.message || {};
                    frappe.msgprint({
                        title: 'Bank Deposit Created',
                        indicator: 'green',
                        message: `Bank Deposit <a href="/app/si-pos-bank-deposit/${encodeURIComponent(doc.name)}" target="_blank">${frappe.utils.escape_html(doc.name)}</a> created. Journal Entry: <a href="/app/journal-entry/${encodeURIComponent(doc.journal_entry)}" target="_blank">${frappe.utils.escape_html(doc.journal_entry)}</a>`
                    });
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Bank Deposit creation failed. Check bank/from accounts, permissions, and Mode of Payment setup.');
                }
            }
        });
        d.show();
    }

    async function show_created_invoices_dialog() {
        const inst = get_pos_instance();
        const company = inst && inst.company_field ? inst.company_field.get_value() : null;
        const customer = inst && inst.customer_field ? inst.customer_field.get_value() : null;
        const currency = frappe.defaults.get_default('currency') || 'OMR';

        try {
            const r = await frappe.call({
                method: 'si_pos.api.pos_actions.get_created_sales_invoices',
                args: { company: company, customer: customer || null, limit: 100 },
                freeze: true,
                freeze_message: 'Loading Sales Invoices...'
            });
            const data = r.message || {};
            const rows = (data.invoices || []).map(inv => {
                const status = inv.docstatus === 1 ? 'Submitted' : (inv.docstatus === 2 ? 'Cancelled' : 'Draft');
                const type = inv.is_return ? 'Return' : 'Sale';
                return `
                    <tr>
                        <td><a href="/app/sales-invoice/${encodeURIComponent(inv.name)}" target="_blank">${frappe.utils.escape_html(inv.name)}</a></td>
                        <td>${frappe.utils.escape_html(inv.customer_name || inv.customer || '')}</td>
                        <td>${frappe.utils.escape_html(inv.posting_date || '')}</td>
                        <td>${status}</td>
                        <td>${type}</td>
                        <td style="text-align:right;">${format_currency(inv.rounded_total || inv.grand_total || 0, currency)}</td>
                        <td style="text-align:right;">${format_currency(inv.outstanding_amount || 0, currency)}</td>
                    </tr>`;
            }).join('') || '<tr><td colspan="7" class="text-muted">No Sales Invoices found.</td></tr>';

            const html = `
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px;">
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Invoices</div><div style="font-size:22px; font-weight:900;">${data.count || 0}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Total</div><div style="font-size:22px; font-weight:900;">${format_currency(data.total || 0, currency)}</div></div>
                    <div class="frappe-card" style="padding:12px;"><div class="text-muted">Outstanding</div><div style="font-size:22px; font-weight:900;">${format_currency(data.outstanding || 0, currency)}</div></div>
                </div>
                <table class="table table-bordered table-sm">
                    <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Status</th><th>Type</th><th style="text-align:right;">Total</th><th style="text-align:right;">Outstanding</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;

            const d = new frappe.ui.Dialog({
                title: 'Sales Invoices Created',
                size: 'extra-large',
                fields: [{ fieldtype: 'HTML', fieldname: 'html', options: html }],
                primary_action_label: 'Close',
                primary_action: () => d.hide()
            });
            d.show();
        } catch (e) {
            frappe.msgprint('Unable to load Sales Invoices. Check Sales Invoice read permission.');
        }
    }

    async function show_available_stock_dialog() {
        const inst = get_pos_instance();
        const warehouse = inst && inst.warehouse_field ? inst.warehouse_field.get_value() : null;
        if (!warehouse) return frappe.msgprint('Please select Warehouse first.');

        const d = new frappe.ui.Dialog({
            title: `Available Stock - ${warehouse}`,
            size: 'extra-large',
            fields: [
                { fieldtype: 'Data', fieldname: 'stock_search', label: 'Search Item' },
                { fieldtype: 'Button', fieldname: 'stock_search_btn', label: 'Search' },
                { fieldtype: 'HTML', fieldname: 'stock_html', options: '<div class="text-muted">Loading stock...</div>' }
            ],
            primary_action_label: 'Close',
            primary_action: () => d.hide()
        });
        d.show();

        const load = async () => {
            const values = d.get_values() || {};
            d.fields_dict.stock_html.$wrapper.html('<div class="text-muted">Loading stock...</div>');
            try {
                const r = await frappe.call({
                    method: 'si_pos.api.pos_actions.get_available_stock',
                    args: { warehouse: warehouse, txt: values.stock_search || '', limit: 300 }
                });
                const data = r.message || {};
                const rows = (data.items || []).map(item => `
                    <tr>
                        <td>${frappe.utils.escape_html(item.item_code)}</td>
                        <td>${frappe.utils.escape_html(item.item_name || '')}</td>
                        <td>${frappe.utils.escape_html(item.stock_uom || '')}</td>
                        <td style="text-align:right;font-weight:900;">${format_number(item.actual_qty || 0, null, 3)}</td>
                        <td style="text-align:right;font-weight:900;">${format_number(item.available_qty || 0, null, 3)}</td>
                        <td style="text-align:right;">${format_number(item.reserved_qty || 0, null, 3)}</td>
                    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">No available stock found.</td></tr>';

                d.fields_dict.stock_html.$wrapper.html(`
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px;">
                        <div class="frappe-card" style="padding:12px;"><div class="text-muted">Items</div><div style="font-size:22px; font-weight:900;">${data.count || 0}</div></div>
                        <div class="frappe-card" style="padding:12px;"><div class="text-muted">Actual Qty</div><div style="font-size:22px; font-weight:900;">${format_number(data.total_actual_qty || 0, null, 3)}</div></div>
                        <div class="frappe-card" style="padding:12px;"><div class="text-muted">Available Qty</div><div style="font-size:22px; font-weight:900;">${format_number(data.total_available_qty || 0, null, 3)}</div></div>
                    </div>
                    <table class="table table-bordered table-sm">
                        <thead><tr><th>Item Code</th><th>Item Name</th><th>UOM</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Available</th><th style="text-align:right;">Reserved</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>`);
            } catch (e) {
                d.fields_dict.stock_html.$wrapper.html('<div class="text-danger">Unable to load stock. Check warehouse and Item permission.</div>');
            }
        };

        d.fields_dict.stock_search_btn.$input.on('click', load);
        d.fields_dict.stock_search.$input.on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                load();
            }
        });
        load();
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (is_si_pos_page()) ensure_header();
            tries += 1;
            if (tries >= MAX_TRIES || ($('.si-extra-advance-btn').length && $('.si-extra-expense-btn').length && $('.si-extra-bank-btn').length)) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
