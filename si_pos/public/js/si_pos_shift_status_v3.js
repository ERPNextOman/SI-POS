(function () {
    if (window.__si_pos_shift_status_v3_loaded) return;
    window.__si_pos_shift_status_v3_loaded = true;

    const WAIT_MS = 700;
    const MAX_TRIES = 120;
    const POLL_MS = 5000;
    let pollStarted = false;

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

    function money(value) {
        return format_currency(value || 0, currency());
    }

    function ensure_style() {
        if ($('#si-pos-shift-status-v3-style').length) return;
        $('head').append(`
            <style id="si-pos-shift-status-v3-style">
                .si-pos-shift-banner,
                .si-pos-shift-pill {
                    display: none !important;
                }
                .si-pos-head {
                    position: relative;
                }
                .si-pos-shift-inline {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 8px;
                    padding: 5px 10px;
                    border-radius: 999px;
                    font-size: 12px;
                    line-height: 18px;
                    font-weight: 900;
                    white-space: nowrap;
                    border: 1px solid rgba(255,255,255,.35);
                    box-shadow: 0 4px 12px rgba(15,23,42,.12);
                }
                .si-pos-shift-inline.open {
                    background: rgba(220,252,231,.95);
                    color: #166534;
                }
                .si-pos-shift-inline.closed {
                    background: rgba(254,226,226,.95);
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

    function ensure_inline_status() {
        ensure_style();
        $('.si-pos-shift-banner').remove();
        $('.si-pos-extra-controls .si-pos-shift-pill').remove();

        const head = $('.si-pos-head');
        const title = head.find('.si-pos-title').first();
        if (!head.length || !title.length) return null;

        let inline = head.find('.si-pos-shift-inline');
        if (!inline.length) {
            title.after('<div class="si-pos-shift-inline closed">POS CLOSED</div>');
            inline = head.find('.si-pos-shift-inline');
        }
        return inline;
    }

    function set_status(open, shift) {
        const inline = ensure_inline_status();
        if (!inline) return;

        if (open) {
            const opening = shift && shift.opening_amount != null ? money(shift.opening_amount) : '';
            inline.removeClass('closed').addClass('open');
            inline.text(opening ? `POS OPEN | Opening: ${opening}` : 'POS OPEN');
        } else {
            inline.removeClass('open').addClass('closed');
            inline.text('POS CLOSED');
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

    function force_closed() {
        window.si_pos_shift_is_open = false;
        window.si_pos_cash_shift = { exists: false, needs_shift: true };
        set_status(false);
        set_locked(true);
    }

    async function refresh_status() {
        if (!is_pos_page()) return;
        ensure_inline_status();
        $('.si-pos-extra-controls .si-pos-shift-pill').remove();
        $('.si-pos-shift-banner').remove();

        const c = company();
        const w = warehouse();
        if (!c || !w) {
            force_closed();
            return;
        }

        try {
            const r = await frappe.call({
                method: 'si_pos.api.cash_shift.get_open_shift',
                args: { company: c, warehouse: w }
            });
            const data = r.message || {};
            const open = !!(data.exists && data.name);
            window.si_pos_shift_is_open = open;
            window.si_pos_cash_shift = data;
            set_status(open, data);
            set_locked(!open);
        } catch (e) {
            // Keep page usable if migration/assets are temporarily out of sync.
        }
    }

    function bind_blocker() {
        $(document).off('click.si_shift_status_v3_block').on('click.si_shift_status_v3_block', '.si-pos-disabled-area', function (e) {
            const target = $(e.target);
            if (!window.si_pos_shift_is_open && !target.closest('.modal, .frappe-dialog').length) {
                e.preventDefault();
                e.stopImmediatePropagation();
                frappe.show_alert({ message: 'POS is closed. Click Shift Start first.', indicator: 'red' });
                return false;
            }
        });
    }

    function bind_modal_refresh() {
        $(document)
            .off('hidden.bs.modal.si_shift_status_v3_refresh')
            .on('hidden.bs.modal.si_shift_status_v3_refresh', '.modal', function () {
                if (is_pos_page()) setTimeout(refresh_status, 400);
            });

        window.si_pos_refresh_shift_lock = refresh_status;
        window.si_pos_force_shift_closed = force_closed;
    }

    function start_poll() {
        if (pollStarted) return;
        pollStarted = true;
        setInterval(() => {
            if (is_pos_page()) refresh_status();
        }, POLL_MS);
    }

    function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (is_pos_page()) {
                bind_blocker();
                bind_modal_refresh();
                refresh_status();
                start_poll();
            }
            tries += 1;
            if (tries >= MAX_TRIES || $('.si-pos-shift-inline').length) clearInterval(timer);
        }, WAIT_MS);
    }

    $(document).on('page-change', boot);
    $(document).ready(boot);
})();
