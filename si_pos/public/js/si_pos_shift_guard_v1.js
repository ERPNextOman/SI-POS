(function () {
    if (window.__si_pos_shift_guard_v1_loaded) return;
    window.__si_pos_shift_guard_v1_loaded = true;

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

    function ensure_style() {
        if ($('#si-pos-shift-guard-style').length) return;
        $('head').append(`
            <style id="si-pos-shift-guard-style">
                .si-pos-shift-banner {
                    margin: 10px 0 0 0;
                    padding: 10px 14px;
                    border-radius: 14px;
                    font-weight: 900;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                }
                .si-pos-shift-banner.closed {
                    background: #fee2e2;
                    color: #991b1b;
                    border: 1px solid #fecaca;
                }
                .si-pos-shift-banner.open {
                    background: #dcfce7;
                    color: #166534;
                    border: 1px solid #bbf7d0;
                }
                .si-pos-locked-hint {
                    font-size: 12px;
                    font-weight: 800;
                    opacity: .85;
                }
                .si-pos-disabled-area {
                    opacity: .45 !important;
                    filter: grayscale(.25);
                }
                .si-pos-disabled-area * {
                    cursor: not-allowed !important;
                }
            </style>
        `);
    }

    function ensure_banner() {
        if (!$('.si-pos-head').length) return null;
        ensure_style();
        let banner = $('.si-pos-shift-banner');
        if (!banner.length) {
            $('.si-pos-head').after(`
                <div class="si-pos-shift-banner closed">
                    <div class="si-pos-shift-title">POS is CLOSED</div>
                    <div class="si-pos-locked-hint">Click Shift Start and enter opening denomination to enable sales.</div>
                </div>
            `);
            banner = $('.si-pos-shift-banner');
        }
        return banner;
    }

    function set_banner(open, shift) {
        const banner = ensure_banner();
        if (!banner) return;

        if (open) {
            banner.removeClass('closed').addClass('open');
            banner.find('.si-pos-shift-title').text('POS is OPEN');
            const opening = shift && shift.opening_amount != null ? format_currency(shift.opening_amount, frappe.defaults.get_default('currency') || 'OMR') : '';
            banner.find('.si-pos-locked-hint').text(opening ? `Open shift active. Opening balance: ${opening}` : 'Open shift active.');
        } else {
            banner.removeClass('open').addClass('closed');
            banner.find('.si-pos-shift-title').text('POS is CLOSED');
            banner.find('.si-pos-locked-hint').text('Click Shift Start and enter opening denomination to enable sales.');
        }
    }

    function pos_work_area() {
        const wrap = $('.si-pos-wrap');
        if (!wrap.length) return $();
        // Everything after the top header/banner is working POS area.
        return wrap.find('.si-pos-head').nextAll().not('.si-pos-shift-banner');
    }

    function set_locked(locked) {
        const area = pos_work_area();
        if (!area.length) return;

        area.toggleClass('si-pos-disabled-area', locked);

        area.find('input, select, textarea, button').each(function () {
            const el = $(this);
            if (el.closest('.si-pos-extra-controls, .modal, .frappe-dialog').length) return;
            if (el.hasClass('si-shift-start-btn') || el.hasClass('si-extra-closing-btn')) return;
            el.prop('disabled', locked);
        });
    }

    function bind_blocker() {
        $(document).off('click.si_shift_guard_block').on('click.si_shift_guard_block', '.si-pos-disabled-area', function (e) {
            const target = $(e.target);
            if (!window.si_pos_shift_is_open && !target.closest('.modal, .frappe-dialog').length) {
                e.preventDefault();
                e.stopImmediatePropagation();
                frappe.show_alert({ message: 'POS is closed. Click Shift Start first.', indicator: 'red' });
                return false;
            }
        });
    }

    async function refresh_shift_guard() {
        if (!is_pos_page()) return;
        const c = company();
        const w = warehouse();
        ensure_banner();

        if (!c || !w) {
            window.si_pos_shift_is_open = false;
            set_banner(false);
            set_locked(true);
            return;
        }

        try {
            const r = await frappe.call({
                method: 'si_pos.api.cash_shift.get_open_shift',
                args: { company: c, warehouse: w }
            });
            const data = r.message || {};
            const isOpen = !!(data.exists && data.name);
            window.si_pos_shift_is_open = isOpen;
            window.si_pos_cash_shift = data;
            set_banner(isOpen, data);
            set_locked(!isOpen);
        } catch (e) {
            // If migration is pending, keep UI usable rather than breaking the page.
            window.si_pos_shift_is_open = true;
            set_banner(true);
            set_locked(false);
        }
    }

    function patch_shift_start_success() {
        // Refresh guard after the user starts a shift from the existing Shift Start dialog.
        $(document).off('hidden.bs.modal.si_shift_guard_refresh').on('hidden.bs.modal.si_shift_guard_refresh', '.modal', function () {
            if (is_pos_page()) setTimeout(refresh_shift_guard, 500);
        });
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (is_pos_page()) {
                bind_blocker();
                patch_shift_start_success();
                refresh_shift_guard();
            }
            tries += 1;
            if (tries >= MAX_TRIES) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
