(function () {
    if (window.__si_pos_cash_shift_v2_file_loaded) return;
    window.__si_pos_cash_shift_v2_file_loaded = true;

    const DENOMS = [50, 20, 10, 5, 1, 0.5, 0.1, 0.05];
    const WAIT_MS = 700;
    const MAX_TRIES = 120;

    function is_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function inst() {
        return window.si_pos_current_instance || $('.si-pos-wrap').closest('.page-wrapper').data('si_pos_instance') || null;
    }

    function company() {
        const i = inst();
        return i && i.company_field ? i.company_field.get_value() : null;
    }

    function warehouse() {
        const i = inst();
        return i && i.warehouse_field ? i.warehouse_field.get_value() : null;
    }

    function money(value) {
        return format_currency(value || 0, frappe.defaults.get_default('currency') || 'OMR');
    }

    function button_html(cls, label) {
        return `<button class="btn btn-light ${cls}" style="height:32px; border-radius:9px; font-weight:900;">${label}</button>`;
    }

    function ensure_shift_buttons() {
        if (!is_pos_page() || !$('.si-pos-head').length) return false;

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

        if (!controls.find('.si-shift-start-btn').length) {
            if (controls.find('.si-extra-customer-btn').length) controls.find('.si-extra-customer-btn').after(button_html('si-shift-start-btn', 'Shift Start'));
            else controls.prepend(button_html('si-shift-start-btn', 'Shift Start'));
        }

        controls.find('.si-extra-closing-btn').text('Shift Close');
        return true;
    }

    function denom_table(prefix) {
        return `
            <table class="table table-bordered table-sm si-denom-table" data-prefix="${prefix}">
                <thead><tr><th>Denomination</th><th style="width:120px;">Qty</th><th style="text-align:right;">Amount</th></tr></thead>
                <tbody>
                    ${DENOMS.map(d => `
                        <tr data-denom="${d}">
                            <td>${d.toFixed(d < 1 ? 2 : 0)}</td>
                            <td><input class="form-control input-xs si-denom-qty" type="number" step="1" min="0" value="0"></td>
                            <td class="si-denom-amount" style="text-align:right;font-weight:900;">${money(0)}</td>
                        </tr>`).join('')}
                </tbody>
                <tfoot><tr><th colspan="2">Total</th><th class="si-denom-total" style="text-align:right;">${money(0)}</th></tr></tfoot>
            </table>
        `;
    }

    function read_denoms(wrapper) {
        const rows = [];
        wrapper.find('.si-denom-table tbody tr').each(function () {
            const denomination = flt($(this).attr('data-denom'));
            const qty = flt($(this).find('.si-denom-qty').val());
            rows.push({ denomination, qty, amount: denomination * qty });
        });
        return rows;
    }

    function refresh_denoms(wrapper) {
        let total = 0;
        wrapper.find('.si-denom-table tbody tr').each(function () {
            const denom = flt($(this).attr('data-denom'));
            const qty = flt($(this).find('.si-denom-qty').val());
            const amount = denom * qty;
            total += amount;
            $(this).find('.si-denom-amount').text(money(amount));
        });
        wrapper.find('.si-denom-total').text(money(total));
        return total;
    }

    async function refresh_open_shift_status() {
        if (!is_pos_page()) return null;
        const c = company();
        const w = warehouse();
        if (!c || !w) return null;

        try {
            const r = await frappe.call({ method: 'si_pos.api.cash_shift.get_open_shift', args: { company: c, warehouse: w } });
            const data = r.message || {};
            window.si_pos_cash_shift = data;
            return data;
        } catch (e) {
            return null;
        }
    }

    async function start_shift_from_button() {
        const c = company();
        const w = warehouse();
        if (!c) return frappe.msgprint('Please select Company first.');
        if (!w) return frappe.msgprint('Please select Warehouse first.');

        const data = await refresh_open_shift_status();
        if (data && data.exists && data.name) {
            frappe.msgprint({
                title: 'Shift Already Open',
                indicator: 'blue',
                message: `Open Cash Shift: <a href="/app/si-pos-cash-shift/${encodeURIComponent(data.name)}" target="_blank">${frappe.utils.escape_html(data.name)}</a><br>Opening Balance: <b>${money(data.opening_amount || 0)}</b>`
            });
            return;
        }
        show_opening_dialog(c, w);
    }

    function show_opening_dialog(c, w) {
        if (window.__si_pos_opening_dialog_visible) return;
        window.__si_pos_opening_dialog_visible = true;

        const d = new frappe.ui.Dialog({
            title: 'Shift Start - Opening Balance',
            size: 'large',
            fields: [
                { fieldtype: 'HTML', fieldname: 'info', options: `<div class="alert alert-warning">Enter opening cash denomination before starting POS for warehouse <b>${frappe.utils.escape_html(w)}</b>.</div>` },
                { fieldtype: 'HTML', fieldname: 'denoms', options: denom_table('opening') },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: 'Remarks' }
            ],
            primary_action_label: 'Start POS',
            primary_action: async (values) => {
                const rows = read_denoms(d.$wrapper);
                try {
                    const r = await frappe.call({
                        method: 'si_pos.api.cash_shift.start_shift',
                        args: { company: c, warehouse: w, opening_denominations: rows, remarks: values.remarks || '' },
                        freeze: true,
                        freeze_message: 'Starting POS shift...'
                    });
                    window.si_pos_cash_shift = r.message || {};
                    frappe.show_alert({ message: `POS shift started. Opening: ${money(window.si_pos_cash_shift.opening_amount || 0)}`, indicator: 'green' });
                    window.__si_pos_opening_dialog_visible = false;
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Could not start POS shift. Check permissions and warehouse/company.');
                }
            }
        });
        d.show();
        d.$wrapper.on('input', '.si-denom-qty', () => refresh_denoms(d.$wrapper));
        d.$wrapper.on('hidden.bs.modal', () => { window.__si_pos_opening_dialog_visible = false; });
    }

    async function get_closing_data() {
        const r = await frappe.call({ method: 'si_pos.api.pos_actions.get_cashier_daily_closing', args: { company: company(), warehouse: warehouse() } });
        return r.message || {};
    }

    function show_closing_denom_dialog(closingData) {
        const d = new frappe.ui.Dialog({
            title: 'Closing Denomination',
            size: 'large',
            fields: [
                { fieldtype: 'HTML', fieldname: 'summary', options: `<div class="alert alert-info">Available Till Balance: <b>${money(closingData.available_till_balance || 0)}</b><br>Till Available Balance: <b>${money(closingData.till_available_balance || 0)}</b></div>` },
                { fieldtype: 'HTML', fieldname: 'denoms', options: denom_table('closing') },
                { fieldtype: 'Small Text', fieldname: 'remarks', label: 'Closing Remarks' }
            ],
            primary_action_label: 'Close Shift',
            primary_action: async (values) => {
                const rows = read_denoms(d.$wrapper);
                try {
                    const r = await frappe.call({
                        method: 'si_pos.api.cash_shift.close_shift',
                        args: { company: company(), warehouse: warehouse(), closing_denominations: rows, closing_summary: closingData, remarks: values.remarks || '' },
                        freeze: true,
                        freeze_message: 'Closing shift...'
                    });
                    const res = r.message || {};
                    frappe.msgprint({ title: 'Shift Closed', indicator: 'green', message: `Cash Shift <a href="/app/si-pos-cash-shift/${encodeURIComponent(res.name)}" target="_blank">${frappe.utils.escape_html(res.name)}</a> closed.<br>Difference: <b>${money(res.difference || 0)}</b>` });
                    await refresh_open_shift_status();
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Could not close shift. Check if an open shift exists.');
                }
            }
        });
        d.show();
        d.$wrapper.on('input', '.si-denom-qty', () => refresh_denoms(d.$wrapper));
    }

    function bind_shift_buttons() {
        $(document).off('click.si_shift_start_v2_file').on('click.si_shift_start_v2_file', '.si-shift-start-btn', start_shift_from_button);
        $(document).off('click.si_shift_close_v2_file').on('click.si_shift_close_v2_file', '.si-closing-denom-btn', async function () {
            const data = await get_closing_data();
            show_closing_denom_dialog(data);
        });
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (is_pos_page()) {
                ensure_shift_buttons();
                bind_shift_buttons();
                refresh_open_shift_status();
            }
            tries += 1;
            if (tries >= MAX_TRIES || ($('.si-shift-start-btn').length && $('.si-extra-closing-btn').text().trim() === 'Shift Close')) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
