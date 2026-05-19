(function () {
    if (window.__si_pos_shift_guard_v2_loaded) return;
    window.__si_pos_shift_guard_v2_loaded = true;

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

    function currency() {
        return frappe.defaults.get_default('currency') || 'OMR';
    }

    function ensure_style() {
        if ($('#si-pos-shift-guard-v2-style').length) return;
        $('head').append(`
            <style id="si-pos-shift-guard-v2-style">
                .si-pos-shift-banner {
                    display: none !important;
                }
                .si-pos-shift-pill {
                    height: 32px;
                    border-radius: 999px;
                    padding: 6px 12px;
                    font-size: 13px;
                    line-height: 20px;
                    font-weight: 900;
                    white-space: nowrap;
                    border: 1px solid rgba(255,255,255,.45);
                    box-shadow: 0 6px 18px rgba(15, 23, 42, .12);
                }
                .si-pos-shift-pill.open {
                    background: #dcfce7;
                    color: #166534;
                }
                .si-pos-shift-pill.closed {
                    background: #fee2e2;
                    color: #991b1b;
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

    function ensure_pill() {
        ensure_style();
        $('.si-pos-shift-banner').remove();

        let controls = $('.si-pos-extra-controls');
        if (!controls.length) {
            if (!$('.si-pos-head').length) return null;
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

        let pill = controls.find('.si-pos-shift-pill');
        if (!pill.length) {
            controls.prepend('<div class="si-pos-shift-pill closed">POS CLOSED</div>');
            pill = controls.find('.si-pos-shift-pill');
        }
        return pill;
    }

    function set_status(open, shift) {
        const pill = ensure_pill();
        if (!pill) return;

        if (open) {
            const opening = shift && shift.opening_amount != null
                ? format_currency(shift.opening_amount, currency())
                : '';
            pill.removeClass('closed').addClass('open');
            pill.text(opening ? `POS OPEN | Opening: ${opening}` : 'POS OPEN');
        } else {
            pill.removeClass('open').addClass('closed');
            pill.text('POS CLOSED');
        }
    }

    function pos_work_area() {
        const wrap = $('.si-pos-wrap');
        if (!wrap.length) return $();
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
        $(document).off('click.si_shift_guard_v2_block').on('click.si_shift_guard_v2_block', '.si-pos-disabled-area', function (e) {
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
        $('.si-pos-shift-banner').remove();
        ensure_pill();

        const c = company();
        const w = warehouse();

        if (!c || !w) {
            window.si_pos_shift_is_open = false;
            set_status(false);
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
            set_status(isOpen, data);
            set_locked(!isOpen);
        } catch (e) {
            window.si_pos_shift_is_open = true;
            set_status(true);
            set_locked(false);
        }
    }

    function patch_shift_start_success() {
        $(document)
            .off('hidden.bs.modal.si_shift_guard_v2_refresh')
            .on('hidden.bs.modal.si_shift_guard_v2_refresh', '.modal', function () {
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
