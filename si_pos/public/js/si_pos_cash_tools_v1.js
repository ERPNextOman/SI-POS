(function () {
    if (window.__si_pos_cash_tools_v1_loaded) return;
    window.__si_pos_cash_tools_v1_loaded = true;

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

    function ensure_cash_buttons() {
        if (!is_si_pos_page() || !$('.si-pos-head').length) return false;

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

        if (!controls.find('.si-extra-advance-btn').length) {
            const customerBtn = controls.find('.si-extra-customer-btn');
            if (customerBtn.length) customerBtn.after(button_html('si-extra-advance-btn', 'Advance'));
            else controls.prepend(button_html('si-extra-advance-btn', 'Advance'));
        }

        if (!controls.find('.si-extra-expense-btn').length) {
            const advanceBtn = controls.find('.si-extra-advance-btn');
            if (advanceBtn.length) advanceBtn.after(button_html('si-extra-expense-btn', 'Daily Expense'));
            else controls.append(button_html('si-extra-expense-btn', 'Daily Expense'));
        }

        if (!controls.find('.si-extra-bank-btn').length) {
            const expenseBtn = controls.find('.si-extra-expense-btn');
            if (expenseBtn.length) expenseBtn.after(button_html('si-extra-bank-btn', 'Bank Deposit'));
            else controls.append(button_html('si-extra-bank-btn', 'Bank Deposit'));
        }

        bind_events();
        return true;
    }

    function bind_events() {
        $(document).off('click.si_pos_cash_advance').on('click.si_pos_cash_advance', '.si-extra-advance-btn', show_advance_dialog);
        $(document).off('click.si_pos_cash_expense').on('click.si_pos_cash_expense', '.si-extra-expense-btn', show_expense_dialog);
        $(document).off('click.si_pos_cash_bank').on('click.si_pos_cash_bank', '.si-extra-bank-btn', show_bank_deposit_dialog);
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
                    frappe.msgprint('Advance creation failed. Check customer, Mode of Payment account, and Payment Entry permission.');
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

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (is_si_pos_page()) ensure_cash_buttons();
            tries += 1;
            if (tries >= MAX_TRIES || ($('.si-extra-advance-btn').length && $('.si-extra-expense-btn').length && $('.si-extra-bank-btn').length)) {
                clearInterval(timer);
            }
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
