(function () {
    if (window.__si_pos_scan_compact_v1_loaded) return;
    window.__si_pos_scan_compact_v1_loaded = true;

    const WAIT_MS = 500;
    const MAX_TRIES = 120;
    let scanTimer = null;
    let scanBusy = false;
    let lastAutoScan = '';

    function is_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function inst() {
        return window.si_pos_current_instance || $('.si-pos-wrap').closest('.page-wrapper').data('si_pos_instance') || null;
    }

    function ensure_style() {
        if ($('#si-pos-scan-compact-v1-style').length) return;
        $('head').append(`
            <style id="si-pos-scan-compact-v1-style">
                .si-compact-search-scan-row {
                    display: grid;
                    grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr);
                    gap: 10px;
                    align-items: end;
                }
                .si-compact-search-scan-row .si-search-row {
                    display: grid !important;
                    grid-template-columns: minmax(0, 1fr) auto;
                    gap: 8px;
                    align-items: end;
                }
                .si-compact-scan-control label {
                    font-size: 12px;
                    font-weight: 700;
                    color: #4b5563;
                    margin-bottom: 4px;
                    display: block;
                }
                .si-compact-scan-control .si-scan-input {
                    min-height: 32px !important;
                    height: 32px !important;
                    padding: 5px 10px !important;
                    border-radius: 9px !important;
                }
                .si-scan-add-btn,
                .si-focus-scan-btn {
                    display: none !important;
                }
                .si-phase4-box.si-phase4-hidden-shell {
                    display: none !important;
                }
                @media (max-width: 900px) {
                    .si-compact-search-scan-row {
                        grid-template-columns: 1fr;
                    }
                }
            </style>
        `);
    }

    function compact_scan_ui() {
        if (!is_pos_page()) return false;
        const searchCard = $('.si-search').closest('.si-card');
        const scanBox = $('.si-phase4-box').first();
        if (!searchCard.length || !scanBox.length) return false;
        if (searchCard.find('.si-compact-search-scan-row').length) return true;

        ensure_style();

        const searchRow = searchCard.find('> .si-search-row').first();
        const scanInput = scanBox.find('.si-scan-input').first();
        const stockWarning = scanBox.find('.si-stock-warning').first();

        scanBox.find('.si-scan-add-btn, .si-focus-scan-btn').remove();

        const scanControl = $('<div class="si-compact-scan-control"></div>');
        scanControl.append('<label>Barcode / Fast Scan</label>');
        scanControl.append(scanInput);

        const compactRow = $('<div class="si-compact-search-scan-row"></div>');
        compactRow.append(searchRow);
        compactRow.append(scanControl);

        searchCard.prepend(compactRow);
        if (stockWarning.length) searchCard.find('.si-results').before(stockWarning);
        scanBox.addClass('si-phase4-hidden-shell');

        bind_scan_events();
        return true;
    }

    function is_locked() {
        return window.si_pos_shift_is_open === false;
    }

    async function resolve_and_add(show_error) {
        if (scanBusy) return;
        if (is_locked()) {
            if (show_error) frappe.show_alert({ message: 'POS is closed. Click Shift Start first.', indicator: 'red' });
            return;
        }

        const input = $('.si-scan-input');
        const txt = (input.val() || '').trim();
        const i = inst();
        if (!txt || !i) return;

        scanBusy = true;
        try {
            const r = await frappe.call({
                method: 'si_pos.api.barcode_stock.resolve_scan',
                args: {
                    txt: txt,
                    price_list: i.price_list_field ? i.price_list_field.get_value() : null,
                    warehouse: i.warehouse_field ? i.warehouse_field.get_value() : null,
                },
                freeze: false,
            });
            const item = r.message;
            add_item_to_cart(item);
            input.val('').focus();
            lastAutoScan = '';
            await refresh_stock_warning();
        } catch (e) {
            if (show_error) frappe.show_alert({ message: 'No item found for scan', indicator: 'red' });
            input.focus().select();
        } finally {
            scanBusy = false;
        }
    }

    function add_item_to_cart(item) {
        const i = inst();
        if (!i || !item || !item.item_code) return;
        const existing = i.cart.find(row => row.item_code === item.item_code);
        if (existing) existing.qty = flt(existing.qty) + 1;
        else i.cart.push({
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            qty: 1,
            rate: flt(item.rate || 0),
        });
        if (i.schedule_preview) i.schedule_preview();
        else if (i.render_cart) i.render_cart();
        frappe.show_alert({ message: `${item.item_code} added`, indicator: 'green' });
    }

    async function refresh_stock_warning() {
        const i = inst();
        if (!i || !i.cart || !i.cart.length) {
            $('.si-stock-warning').hide().empty();
            return;
        }

        try {
            const r = await frappe.call({
                method: 'si_pos.api.barcode_stock.get_cart_stock_status',
                args: {
                    items: i.cart,
                    warehouse: i.warehouse_field ? i.warehouse_field.get_value() : null,
                }
            });
            const data = r.message || {};
            const warnings = (data.items || []).filter(row => row.has_stock_warning);
            if (!warnings.length) {
                $('.si-stock-warning').hide().empty();
                return;
            }
            const html = warnings.map(row => `${frappe.utils.escape_html(row.item_code)} requested ${row.requested_qty}, available ${row.available_qty}`).join('<br>');
            $('.si-stock-warning').html(`Stock Warning:<br>${html}`).show();
        } catch (e) {
            $('.si-stock-warning').hide().empty();
        }
    }

    function bind_scan_events() {
        // Disable old phase 4 Add/Focus events and own the scanner behavior here.
        $(document).off('keydown.si_phase4_scan');
        $(document).off('click.si_phase4_scanadd');
        $(document).off('click.si_phase4_focus');

        $(document)
            .off('keydown.si_scan_compact')
            .on('keydown.si_scan_compact', '.si-scan-input', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    clearTimeout(scanTimer);
                    resolve_and_add(true);
                }
            });

        $(document)
            .off('input.si_scan_compact')
            .on('input.si_scan_compact', '.si-scan-input', function () {
                clearTimeout(scanTimer);
                const value = ($(this).val() || '').trim();
                if (!value || value.length < 3 || value === lastAutoScan) return;
                scanTimer = setTimeout(() => {
                    const current = ($('.si-scan-input').val() || '').trim();
                    if (!current || current.length < 3 || current !== value) return;
                    lastAutoScan = current;
                    resolve_and_add(false);
                }, 650);
            });
    }

    function focus_after_actions() {
        const input = $('.si-scan-input');
        if (input.length && !is_locked()) setTimeout(() => input.focus(), 250);
    }

    function bind_auto_focus() {
        $(document)
            .off('click.si_scan_compact_focus')
            .on('click.si_scan_compact_focus', '.si-item, .si-clear-btn, .si-submit-print-btn, .si-submit-pay-print-btn, .si-create-btn', focus_after_actions);
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (!is_pos_page()) return;
            const ok = compact_scan_ui();
            bind_scan_events();
            bind_auto_focus();
            tries += 1;
            if (tries >= MAX_TRIES || ok) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
