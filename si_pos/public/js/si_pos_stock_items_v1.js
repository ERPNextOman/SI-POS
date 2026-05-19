(function () {
    if (window.__si_pos_stock_items_v1_loaded) return;
    window.__si_pos_stock_items_v1_loaded = true;

    const WAIT_MS = 700;
    const MAX_TRIES = 120;
    let loadTimer = null;

    function is_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function inst() {
        return window.si_pos_current_instance || $('.si-pos-wrap').closest('.page-wrapper').data('si_pos_instance') || null;
    }

    function warehouse() {
        const i = inst();
        return i && i.warehouse_field ? i.warehouse_field.get_value() : null;
    }

    function price_list() {
        const i = inst();
        return i && i.price_list_field ? i.price_list_field.get_value() : null;
    }

    function search_text() {
        const i = inst();
        if (i && i.search_field) return i.search_field.get_value() || '';
        return $('input[data-fieldname="search"]').val() || '';
    }

    function ensure_style() {
        if ($('#si-pos-stock-items-v1-style').length) return;
        $('head').append(`
            <style id="si-pos-stock-items-v1-style">
                .si-stock-item-qty {
                    font-size: 10px;
                    padding: 3px 7px;
                    border-radius: 999px;
                    background: #dcfce7;
                    color: #166534;
                    font-weight: 900;
                    white-space: nowrap;
                }
                .si-stock-loaded-note {
                    grid-column: 1 / -1;
                    color: #64748b;
                    font-size: 12px;
                    font-weight: 800;
                    padding: 2px 0;
                }
            </style>
        `);
    }

    function render_stock_items(items) {
        const i = inst();
        const results = $('.si-results');
        if (!results.length) return;

        if (!items || !items.length) {
            results.html('<div class="text-muted">No items with available stock in selected warehouse.</div>');
            return;
        }

        const html = [
            `<div class="si-stock-loaded-note">Showing items with stock in warehouse: ${frappe.utils.escape_html(warehouse() || '')}</div>`,
            ...items.map((item) => `
                <div class="si-item" data-item-code="${frappe.utils.escape_html(item.item_code)}">
                    <div class="si-item-top">
                        <div class="si-item-code">${frappe.utils.escape_html(item.item_code)}</div>
                        <div class="si-item-name">${frappe.utils.escape_html(item.item_name || item.item_code)}</div>
                    </div>
                    <div class="si-item-bottom">
                        <span class="si-price">${i && i.format_currency ? i.format_currency(item.rate || 0) : format_currency(item.rate || 0)}</span>
                        <span class="si-stock-item-qty">Stock: ${format_number(item.available_qty || item.actual_qty || 0, null, 3)} ${frappe.utils.escape_html(item.uom || '')}</span>
                    </div>
                </div>
            `)
        ].join('');

        results.html(html);
    }

    async function load_stock_items() {
        if (!is_pos_page()) return;
        const wh = warehouse();
        const results = $('.si-results');
        if (!results.length) return;

        if (!wh) {
            results.html('<div class="text-muted">Select warehouse to show items with available stock.</div>');
            return;
        }

        results.html('<div class="text-muted">Loading stock items...</div>');
        try {
            const r = await frappe.call({
                method: 'si_pos.api.barcode_stock.get_stock_item_cards',
                args: {
                    warehouse: wh,
                    price_list: price_list(),
                    txt: search_text(),
                    limit: 48,
                }
            });
            render_stock_items(r.message || []);
        } catch (e) {
            results.html('<div class="text-danger">Could not load stock items.</div>');
        }
    }

    function schedule_load_stock_items() {
        clearTimeout(loadTimer);
        loadTimer = setTimeout(load_stock_items, 250);
    }

    function patch_search() {
        const i = inst();
        if (!i || i.__stock_items_patch) return;
        i.__stock_items_patch = true;

        const originalSearch = i.search_items ? i.search_items.bind(i) : null;
        i.search_items = async function () {
            if (warehouse()) return load_stock_items();
            if (originalSearch) return originalSearch();
        };

        const originalRenderResults = i.render_results ? i.render_results.bind(i) : null;
        i.render_results = function (items) {
            const filtered = (items || []).filter(row => flt(row.actual_qty) > 0 || flt(row.available_qty) > 0);
            if (originalRenderResults) originalRenderResults(filtered);
            setTimeout(() => {
                $('.si-item').each(function () {
                    const code = $(this).attr('data-item-code');
                    const match = filtered.find(row => row.item_code === code);
                    if (match && !$(this).find('.si-stock-item-qty').length) {
                        $(this).find('.si-tag').replaceWith(`<span class="si-stock-item-qty">Stock: ${format_number(match.available_qty || match.actual_qty || 0, null, 3)} ${frappe.utils.escape_html(match.uom || '')}</span>`);
                    }
                });
            }, 100);
        };
    }

    function bind_events() {
        $(document)
            .off('change.si_stock_items')
            .on('change.si_stock_items', "input[data-fieldname='warehouse'], input[data-fieldname='price_list']", schedule_load_stock_items);

        $(document)
            .off('keyup.si_stock_items')
            .on('keyup.si_stock_items', "input[data-fieldname='search']", function () {
                schedule_load_stock_items();
            });
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (!is_pos_page()) return;
            ensure_style();
            patch_search();
            bind_events();
            if ($('.si-results').length) schedule_load_stock_items();
            tries += 1;
            if (tries >= MAX_TRIES || (inst() && $('.si-results').length)) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
