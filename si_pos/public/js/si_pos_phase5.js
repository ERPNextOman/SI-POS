(function () {
    if (window.__si_pos_phase5_installed) return;
    window.__si_pos_phase5_installed = true;

    const WAIT_MS = 700;
    const MAX_TRIES = 80;

    function is_si_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function inst() {
        return window.si_pos_current_instance || null;
    }

    function add_phase5_button() {
        if (!is_si_pos_page()) return;
        if (!$('.si-pos-wrap').length) return;
        if ($('.si-return-btn').length) return;

        const btn = `<button class="si-btn si-btn-light si-return-btn" style="background:#fee2e2;color:#991b1b;">Return / Exchange</button>`;
        const actions = $('.si-actions-3');
        if (actions.length) {
            actions.css('grid-template-columns', '1fr 1fr 1fr 1fr');
            actions.append(btn);
        }
        bind_events();
    }

    function bind_events() {
        $(document).off('click.si_phase5_return').on('click.si_phase5_return', '.si-return-btn', show_return_dialog);
    }

    function money(value, currency) {
        return format_currency(value || 0, currency || frappe.defaults.get_default('currency') || 'OMR');
    }

    function show_return_dialog() {
        const d = new frappe.ui.Dialog({
            title: 'Return / Exchange',
            size: 'extra-large',
            fields: [
                {
                    fieldtype: 'Section Break',
                    label: 'Find Original Sales Invoice'
                },
                {
                    fieldtype: 'Data',
                    fieldname: 'invoice_search',
                    label: 'Invoice / Customer Search',
                    description: 'Search submitted Sales Invoice by invoice number or customer.'
                },
                {
                    fieldtype: 'Button',
                    fieldname: 'search_btn',
                    label: 'Search Invoice'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'results_html'
                },
                {
                    fieldtype: 'Section Break',
                    label: 'Return Items'
                },
                {
                    fieldtype: 'HTML',
                    fieldname: 'items_html',
                    options: '<div class="text-muted">Search and load an invoice first.</div>'
                },
                {
                    fieldtype: 'Small Text',
                    fieldname: 'reason',
                    label: 'Return Reason'
                }
            ],
            primary_action_label: 'Create Sales Return',
            primary_action: () => create_return_from_dialog(d)
        });

        d.show();

        d.fields_dict.search_btn.$input.on('click', () => search_invoices(d));
        d.fields_dict.invoice_search.$input.on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                search_invoices(d);
            }
        });
    }

    async function search_invoices(d) {
        const values = d.get_values() || {};
        const i = inst();
        const customer = i && i.customer_field ? i.customer_field.get_value() : null;

        d.fields_dict.results_html.$wrapper.html('<div class="text-muted">Searching...</div>');

        try {
            const r = await frappe.call({
                method: 'si_pos.api.returns.search_sales_invoices',
                args: {
                    txt: values.invoice_search || '',
                    customer: customer || null,
                    limit: 20
                }
            });
            const rows = r.message || [];
            if (!rows.length) {
                d.fields_dict.results_html.$wrapper.html('<div class="text-muted">No submitted invoice found.</div>');
                return;
            }

            const html = `
                <table class="table table-bordered table-sm">
                    <thead>
                        <tr>
                            <th>Invoice</th>
                            <th>Customer</th>
                            <th>Date</th>
                            <th style="text-align:right;">Total</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td>${frappe.utils.escape_html(row.name)}</td>
                                <td>${frappe.utils.escape_html(row.customer_name || row.customer || '')}</td>
                                <td>${frappe.utils.escape_html(row.posting_date || '')}</td>
                                <td style="text-align:right;">${money(row.rounded_total || row.grand_total)}</td>
                                <td><button class="btn btn-xs btn-primary si-load-return-invoice" data-invoice="${frappe.utils.escape_html(row.name)}">Load</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
            d.fields_dict.results_html.$wrapper.html(html);
            d.fields_dict.results_html.$wrapper.off('click.si_load_return').on('click.si_load_return', '.si-load-return-invoice', function () {
                load_invoice_items(d, $(this).attr('data-invoice'));
            });
        } catch (e) {
            d.fields_dict.results_html.$wrapper.html('<div class="text-danger">Invoice search failed.</div>');
        }
    }

    async function load_invoice_items(d, invoice) {
        d.si_pos_return_invoice = invoice;
        d.fields_dict.items_html.$wrapper.html('<div class="text-muted">Loading items...</div>');

        try {
            const r = await frappe.call({
                method: 'si_pos.api.returns.get_sales_invoice_for_return',
                args: { sales_invoice: invoice }
            });
            const data = r.message || {};
            d.si_pos_return_data = data;

            if (!data.items || !data.items.length) {
                d.fields_dict.items_html.$wrapper.html('<div class="text-muted">No returnable items found. Items may already be fully returned.</div>');
                return;
            }

            const html = `
                <div style="margin-bottom:8px; font-weight:900;">
                    Loaded: <a href="/app/sales-invoice/${encodeURIComponent(data.name)}" target="_blank">${frappe.utils.escape_html(data.name)}</a>
                    | ${frappe.utils.escape_html(data.customer_name || data.customer || '')}
                    | ${money(data.rounded_total || data.grand_total, data.currency)}
                </div>
                <table class="table table-bordered table-sm si-return-items-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th style="text-align:right;">Sold Qty</th>
                            <th style="text-align:right;">Returned</th>
                            <th style="text-align:right;">Returnable</th>
                            <th style="text-align:right;">Rate</th>
                            <th style="width:120px;">Return Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.items.map(row => `
                            <tr data-detail="${frappe.utils.escape_html(row.name)}">
                                <td>
                                    <div style="font-weight:900;">${frappe.utils.escape_html(row.item_code)}</div>
                                    <div class="text-muted">${frappe.utils.escape_html(row.item_name || '')}</div>
                                </td>
                                <td style="text-align:right;">${row.qty}</td>
                                <td style="text-align:right;">${row.returned_qty}</td>
                                <td style="text-align:right;">${row.returnable_qty}</td>
                                <td style="text-align:right;">${money(row.rate, data.currency)}</td>
                                <td><input class="form-control input-xs si-return-qty" type="number" step="0.001" min="0" max="${row.returnable_qty}" value="0"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="text-muted">Exchange flow: create the return here, then add replacement item in SI POS as a new sale.</div>
            `;
            d.fields_dict.items_html.$wrapper.html(html);
        } catch (e) {
            d.fields_dict.items_html.$wrapper.html('<div class="text-danger">Could not load invoice items.</div>');
        }
    }

    async function create_return_from_dialog(d) {
        if (!d.si_pos_return_invoice || !d.si_pos_return_data) {
            frappe.msgprint('Please load an invoice first.');
            return;
        }

        const return_items = [];
        d.$wrapper.find('.si-return-items-table tbody tr').each(function () {
            const si_detail = $(this).attr('data-detail');
            const qty = flt($(this).find('.si-return-qty').val());
            if (qty > 0) return_items.push({ si_detail, qty });
        });

        if (!return_items.length) {
            frappe.msgprint('Please enter return qty for at least one item.');
            return;
        }

        const values = d.get_values() || {};

        try {
            const r = await frappe.call({
                method: 'si_pos.api.returns.create_sales_return',
                args: {
                    sales_invoice: d.si_pos_return_invoice,
                    return_items: return_items,
                    reason: values.reason || '',
                    submit: 1
                },
                freeze: true,
                freeze_message: 'Creating Sales Return...'
            });
            const ret = r.message;
            d.hide();
            show_return_success(ret);
        } catch (e) {
            frappe.msgprint('Sales Return creation failed. Check return qty, stock settings, warehouse, and permissions.');
        }
    }

    function show_return_success(ret) {
        const i = inst();
        const msg = `Sales Return <a href="/app/sales-invoice/${encodeURIComponent(ret.name)}" target="_blank">${frappe.utils.escape_html(ret.name)}</a> created.`;
        frappe.msgprint({ title: 'Return Created', message: msg, indicator: 'green' });
        frappe.show_alert({ message: `Sales Return ${ret.name} created`, indicator: 'green' });

        if (i && i.wrapper && i.wrapper.find('.si-success-content').length) {
            i.last_invoice = ret;
            i.created_invoice = ret;
            i.wrapper.find('.si-success-content').html(`
                <div>Sales Return: <a href="/app/sales-invoice/${encodeURIComponent(ret.name)}" target="_blank">${frappe.utils.escape_html(ret.name)}</a></div>
                <div style="margin-top:4px; color:#a7f3d0;">For exchange, add replacement item and create a new sale.</div>
            `);
            i.wrapper.find('.si-success-box').show();
        }
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (!is_si_pos_page()) return;
            add_phase5_button();
            tries += 1;
            if (tries >= MAX_TRIES || $('.si-return-btn').length) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
