(function () {
    if (window.__si_pos_phase4_installed) return;
    window.__si_pos_phase4_installed = true;

    const WAIT_MS = 700;
    const MAX_TRIES = 80;

    function is_si_pos_page() {
        return window.location.pathname.includes('/app/si-pos');
    }

    function inst() {
        return window.si_pos_current_instance || null;
    }

    function money(value) {
        const i = inst();
        if (i && i.format_currency) return i.format_currency(value || 0);
        return format_currency(value || 0, frappe.defaults.get_default('currency') || 'OMR');
    }

    function install_ui() {
        if (!is_si_pos_page()) return;
        if (!$('.si-pos-wrap').length) return;
        if ($('.si-phase4-box').length) return;

        const html = `
            <div class="si-card si-phase4-box" style="margin-top:10px;">
                <div style="display:grid; grid-template-columns:1fr auto auto; gap:8px; align-items:end;">
                    <div>
                        <label style="font-size:12px; font-weight:700; color:#4b5563; margin-bottom:4px;">Barcode / Fast Scan</label>
                        <input class="form-control si-scan-input" placeholder="Scan barcode or type item code, then press Enter" style="height:34px; border-radius:9px;">
                    </div>
                    <button class="btn btn-dark si-scan-add-btn" style="height:34px; border-radius:9px; font-weight:900;">Add</button>
                    <button class="btn btn-secondary si-focus-scan-btn" style="height:34px; border-radius:9px; font-weight:900;">Focus</button>
                </div>
                <div class="si-stock-warning" style="display:none; margin-top:8px; padding:8px 10px; border-radius:10px; background:#fff7ed; color:#9a3412; font-size:12px; font-weight:800;"></div>
            </div>
        `;

        const target = $('.si-card').eq(0);
        if (target.length) target.after(html);

        bind_events();
        patch_instance();
    }

    function bind_events() {
        $(document).off('keydown.si_phase4_scan').on('keydown.si_phase4_scan', '.si-scan-input', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                scan_add();
            }
        });
        $(document).off('click.si_phase4_scanadd').on('click.si_phase4_scanadd', '.si-scan-add-btn', scan_add);
        $(document).off('click.si_phase4_focus').on('click.si_phase4_focus', '.si-focus-scan-btn', function () {
            $('.si-scan-input').focus().select();
        });

        $(document).off('keydown.si_phase4_shortcut').on('keydown.si_phase4_shortcut', function (e) {
            if (!is_si_pos_page()) return;
            if (e.altKey && (e.key || '').toLowerCase() === 's') {
                e.preventDefault();
                $('.si-scan-input').focus().select();
            }
        });
    }

    async function scan_add() {
        const input = $('.si-scan-input');
        const txt = (input.val() || '').trim();
        const i = inst();
        if (!txt || !i) return;

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
            await refresh_stock_warning();
        } catch (e) {
            frappe.show_alert({ message: 'No item found for scan', indicator: 'red' });
            input.focus().select();
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

    function patch_instance() {
        const i = inst();
        if (!i || i.__phase4_patched) return;
        i.__phase4_patched = true;

        const original_render_cart = i.render_cart.bind(i);
        i.render_cart = function () {
            original_render_cart();
            setTimeout(refresh_stock_warning, 100);
        };

        const original_add_item = i.add_item ? i.add_item.bind(i) : null;
        if (original_add_item) {
            i.add_item = async function (item_code) {
                await original_add_item(item_code);
                await refresh_stock_warning();
            };
        }
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (!is_si_pos_page()) return;
            install_ui();
            patch_instance();
            tries += 1;
            if (tries >= MAX_TRIES && $('.si-phase4-box').length) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
