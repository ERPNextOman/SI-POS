(function () {
    if (window.__si_pos_cash_shift_v1_loaded) return;
    window.__si_pos_cash_shift_v1_loaded = true;

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

    async function ensure_open_shift() {
        if (!is_pos_page()) return;
        const c = company();
        const w = warehouse();
        if (!c || !w) return;

        try {
            const r = await frappe.call({ method: 'si_pos.api.cash_shift.get_open_shift', args: { company: c, warehouse: w } });
            const data = r.message || {};
            window.si_pos_cash_shift = data;
            if (data.needs_shift) show_opening_dialog(c, w);
        } catch (e) {
            // Do not block POS if app is not migrated yet.
        }
    }

    function show_opening_dialog(c, w) {
        if (window.__si_pos_opening_dialog_visible) return;
        window.__si_pos_opening_dialog_visible = true;

        const d = new frappe.ui.Dialog({
            title: 'Start POS - Opening Balance',
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
        d.$wrapper.find('.modal-header .close').hide();
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
                    d.hide();
                } catch (e) {
                    frappe.msgprint('Could not close shift. Check if an open shift exists.');
                }
            }
        });
        d.show();
        d.$wrapper.on('input', '.si-denom-qty', () => refresh_denoms(d.$wrapper));
    }

    function patch_closing_button() {
        $(document).off('click.si_shift_close').on('click.si_shift_close', '.si-closing-denom-btn', async function () {
            const data = await get_closing_data();
            show_closing_denom_dialog(data);
        });
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (is_pos_page()) {
                ensure_open_shift();
                patch_closing_button();
            }
            tries += 1;
            if (tries >= MAX_TRIES) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
