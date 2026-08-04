frappe.pages['approval-follow-up'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: __('Approval Follow-up'), single_column: true });

	const $container = $(wrapper).find('.layout-main-section');
	const state = {
		selected_tab: '',
		filters: {},
		filter_options: { doctypes: [], companies: [] },
		data: { tabs: [], documents: [], summary: { pending: 0, overdue: 0 } },
		sort_by: 'creation',
		sort_order: 'asc',
		tab_scroll_left: 0,
		restore_search_focus: false,
		search_cursor: 0,
	};
	let search_debounce;

	function apply_filters({ keep_search_focus = false } = {}) {
		state.filters = {
			search: $container.find('[name="search"]').val().trim(),
			doctype: $container.find('[name="doctype"]').val().trim(),
			company: $container.find('[name="company"]').val().trim(),
			from_date: $container.find('[name="from_date"]').val(),
		};
		state.selected_tab = '';
		state.tab_scroll_left = 0;
		state.restore_search_focus = keep_search_focus;
		refresh();
	}

	$container.on('click.approval-follow-up', '[data-af-tab]', function () {
		const tab_scroller = $(this).closest('.af-tabs').get(0);
		state.tab_scroll_left = tab_scroller ? tab_scroller.scrollLeft : 0;
		state.selected_tab = $(this).attr('data-af-tab');
		refresh();
	});

	$container.on('change.approval-follow-up', '[data-af-auto-filter]', function () {
		clearTimeout(search_debounce);
		apply_filters();
	});

	$container.on('input.approval-follow-up', '[name="search"]', function () {
		state.search_cursor = this.selectionStart || 0;
		clearTimeout(search_debounce);
		search_debounce = setTimeout(() => apply_filters({ keep_search_focus: true }), 300);
	});

	$container.on('click.approval-follow-up', '[data-af-refresh]', function () {
		state.selected_tab = '';
		state.tab_scroll_left = 0;
		refresh();
	});

	$container.on('change.approval-follow-up', '[data-af-sort]', function () {
		[state.sort_by, state.sort_order] = $(this).val().split(':');
		refresh();
	});

	async function refresh() {
		$container.find('[data-af-results]').addClass('af-loading');
		try {
			const response = await frappe.call({
				method: 'approval_center.api.get_follow_up_dashboard',
				args: {
					filters: state.filters,
					tab_key: state.selected_tab,
					sort_by: state.sort_by,
					sort_order: state.sort_order,
				},
			});
			state.data = response.message;
			render();
		} catch (error) {
			console.error('Approval Follow-up failed to load:', error);
			$container.find('[data-af-results]').html(`<div class="af-error"><b>${__('Approval Follow-up could not load')}</b><br>${frappe.utils.escape_html(error.message || __('Please contact your system administrator.'))}</div>`);
		}
	}

	async function load_filter_options() {
		try {
			const response = await frappe.call({ method: 'approval_center.api.get_follow_up_filter_options' });
			state.filter_options = response.message;
		} catch (error) {
			console.error('Approval Follow-up filter options failed to load:', error);
		}
		render();
		refresh();
	}

	function format_currency(value, currency) {
		return frappe.format(value, { fieldtype: 'Currency', options: currency || frappe.defaults.get_default('currency') });
	}

	function render() {
		const escaped = frappe.utils.escape_html;
		const { tabs, documents, summary } = state.data;
		const { doctypes, companies } = state.filter_options;
		const selected_sort = `${state.sort_by}:${state.sort_order}`;
		const tabs_html = [
			`<button class="af-tab ${state.selected_tab ? '' : 'active'}" data-af-tab=""><span>${__('All pending workflows')}</span><b>${summary.pending || 0}</b></button>`,
			...tabs.map((tab) => `<button class="af-tab ${state.selected_tab === tab.key ? 'active' : ''}" data-af-tab="${escaped(tab.key)}"><span>${escaped(tab.doctype)} <em>·</em> ${escaped(tab.state)} → ${escaped(tab.next_state)}</span><small>${escaped(tab.role || __('No role'))}</small><b>${tab.count}</b></button>`),
		].join('');
		const cards = documents.length ? documents.map((doc) => {
			const document_id = doc.title && doc.title !== doc.name ? `<p class="af-document-id">${escaped(doc.name)}</p>` : '';
			const dates = (doc.card_dates || []).map((date) => {
				const formatted = frappe.datetime.str_to_user(date.value) || date.value;
				return `<div class="af-date"><small>${escaped(date.label)}</small><strong>${escaped(String(formatted).split(' ')[0])}</strong></div>`;
			}).join('');
			const details = (doc.card_details || []).map((detail) => {
				const value = detail.kind === 'currency' ? format_currency(detail.value, detail.currency || doc.currency) : detail.value;
				return `<div class="af-detail"><small>${escaped(detail.label)}</small><strong>${escaped(String(value))}</strong></div>`;
			}).join('');
			const metrics = (doc.card_metrics || []).map((metric) => {
				const value = metric.kind === 'currency' ? format_currency(metric.value, metric.currency || doc.currency) : metric.value;
				return `<div class="af-metric"><small>${escaped(metric.label)}</small><strong>${escaped(String(value))}</strong></div>`;
			}).join('');
			const next_steps = (doc.next_steps || []).map((step) => `<li><b>${escaped(step.action || __('Continue'))}</b> → ${escaped(step.next_state || __('Next state'))}${step.role ? ` <span>· ${escaped(step.role)}</span>` : ''}</li>`).join('');
			return `<article class="af-card">
				<div class="af-card-head"><span class="af-state">${escaped(doc.state)}</span><span class="af-age">${frappe.datetime.comment_when(doc.creation)}</span></div>
				<div class="af-card-body">
					<p class="af-doc-type">${escaped(doc.doctype)}</p>
					<div class="af-main"><div class="af-title"><h3>${escaped(doc.title || doc.name)}</h3>${document_id}</div>${metrics ? `<div class="af-metrics">${metrics}</div>` : ''}</div>
					${dates ? `<div class="af-dates">${dates}</div>` : ''}
					${details ? `<div class="af-divider"></div><div class="af-details">${details}</div>` : ''}
					<div class="af-next"><small>${__('Next possible transition')}</small><ul>${next_steps}</ul></div>
				</div>
			</article>`;
		}).join('') : `<div class="af-empty"><div class="af-empty-icon">✓</div><h3>${__('No pending workflows')}</h3><p>${__('No open workflow documents match the selected filters.')}</p></div>`;

		$container.html(`
			<style>
				.approval-follow-up { box-sizing: border-box; width: 100%; max-width: 1440px; margin: 0 auto; padding: 0 22px 36px; color: #172b4d; }
				.af-hero { padding: 28px 30px; margin-bottom: 22px; color: #fff; border-radius: 18px; background: linear-gradient(120deg, #172b4d 0%, #1f4b84 60%, #1b6b8e 100%); box-shadow: 0 12px 30px rgba(31,75,132,.18); }.af-hero-top { display:flex; align-items:start; justify-content:space-between; gap:16px; }.af-kicker { margin:0 0 6px; color:#a9d8ff; font-size:12px; font-weight:700; letter-spacing:1.1px; text-transform:uppercase; }.af-hero h2 { margin:0; color:#fff; font-size:27px; font-weight:700; }.af-hero p { margin:8px 0 0; color:#d9e9f8; }.af-refresh { padding:8px 14px; color:#fff; border:1px solid rgba(255,255,255,.28); border-radius:8px; background:rgba(255,255,255,.14); }.af-refresh:hover { color:#fff; background:rgba(255,255,255,.24); }.af-summary { display:flex; gap:12px; margin-top:24px; }.af-summary-card { min-width:170px; padding:13px 15px; border:1px solid rgba(255,255,255,.2); border-radius:12px; background:rgba(255,255,255,.12); }.af-summary-card span { display:block; color:#dceeff; font-size:12px; font-weight:600; }.af-summary-card strong { display:block; margin-top:5px; font-size:28px; line-height:1; }
				.af-toolbar { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:10px; padding:16px; margin-bottom:18px; border:1px solid #e5eaf0; border-radius:14px; background:#fff; box-shadow:0 4px 14px rgba(19,45,83,.05); }.af-toolbar .form-control { height:38px; border-radius:8px; }.af-heading { display:flex; align-items:end; justify-content:space-between; gap:16px; margin:25px 0 12px; }.af-heading h3 { margin:0; color:#1d3557; font-size:18px; }.af-heading p { margin:3px 0 0; color:#718096; font-size:13px; }.af-sort { min-width:210px; height:34px; color:#43566c; border:1px solid #dce4ec; border-radius:8px; background:#fff; font-size:12px; }
				.af-tabs { display:flex; gap:8px; overflow-x:auto; padding:2px 0 14px; margin-bottom:6px; }.af-tab { display:flex; align-items:center; gap:6px; flex:0 0 auto; max-width:360px; padding:7px 11px 7px 13px; color:#45627f; border:1px solid #dfe6ee; border-radius:20px; background:#fff; font-size:12px; text-align:left; }.af-tab:hover { transform:translateY(-1px); }.af-tab span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.af-tab em { font-style:normal; opacity:.7; }.af-tab small { overflow:hidden; max-width:85px; color:#718096; text-overflow:ellipsis; white-space:nowrap; }.af-tab b { min-width:20px; padding:1px 6px; margin-left:auto; color:#334e68; border-radius:10px; background:#eef2f7; font-weight:800; }.af-tab.active { color:#fff; border-color:#0d6db8; background:#1877c9; box-shadow:0 0 0 2px rgba(13,109,184,.2); font-weight:700; }.af-tab.active small { color:#d9edff; }.af-tab.active b { color:#0d5fa4; background:#fff; }
				.af-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(305px,1fr)); gap:16px; }.af-card { overflow:hidden; border:1px solid #e3e8ef; border-radius:14px; background:#fff; box-shadow:0 4px 14px rgba(19,45,83,.05); transition:transform .15s ease,box-shadow .15s ease; }.af-card:hover { transform:translateY(-2px); box-shadow:0 10px 24px rgba(19,45,83,.11); }.af-card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px 0; }.af-state { max-width:72%; overflow:hidden; padding:4px 9px; color:#175f9e; border-radius:20px; background:#e8f3ff; font-size:11px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }.af-age { color:#8494a7; font-size:12px; }.af-card-body { padding:18px 16px 18px; }.af-doc-type { margin:0 0 6px; color:#68809a; font-size:12px; font-weight:600; }.af-main { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }.af-title { min-width:0; flex:1; }.af-card h3 { min-height:25px; margin:0; overflow:hidden; color:#1d3557; font-size:17px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }.af-document-id { margin:5px 0 0; color:#8394a8; font-size:12px; }.af-metrics { display:grid; flex:0 0 155px; gap:9px; text-align:right; }.af-metric small,.af-date small,.af-detail small,.af-next > small { display:block; margin-bottom:3px; color:#8494a7; font-size:10px; font-weight:700; letter-spacing:.35px; text-transform:uppercase; }.af-metric strong,.af-date strong,.af-detail strong { display:block; overflow:hidden; color:#1d3557; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }.af-dates,.af-details { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:12px; margin-top:14px; }.af-divider { height:1px; margin:18px 0 12px; background:#edf0f4; }.af-next { margin-top:18px; padding:12px; border:1px solid #dceafa; border-radius:9px; background:#f7fbff; }.af-next ul { display:grid; gap:5px; padding:0; margin:6px 0 0; list-style:none; color:#3a5d80; font-size:12px; }.af-next li { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.af-next li span { color:#718096; }.af-empty { padding:64px 24px; border:1px dashed #cfd9e5; border-radius:14px; background:#fff; text-align:center; }.af-empty-icon { display:grid; place-items:center; width:44px; height:44px; margin:auto auto 12px; color:#16844a; border-radius:50%; background:#e7f7ef; font-size:21px; font-weight:800; }.af-empty h3 { margin:0 0 6px; font-size:18px; }.af-empty p { margin:0; color:#718096; }.af-error { padding:18px; color:#a61b1b; border:1px solid #ffcccc; border-radius:10px; background:#fff5f5; }.af-loading { opacity:.55; pointer-events:none; }
				@media (max-width:900px) { .af-toolbar { grid-template-columns:repeat(2,minmax(0,1fr)); } } @media (max-width:700px) { .approval-follow-up { padding:0 12px 28px; }.af-hero { padding:22px 18px; }.af-hero-top,.af-heading { align-items:stretch; flex-direction:column; }.af-toolbar { grid-template-columns:1fr; }.af-sort { width:100%; }.af-grid { grid-template-columns:1fr; } }
			</style>
			<section class="approval-follow-up">
				<div class="af-hero"><div class="af-hero-top"><div><div class="af-kicker">${__('Workflow workspace')}</div><h2>${__('Approval Follow-up')}</h2><p>${__('Read-only visibility of documents awaiting their next workflow transition.')}</p></div><button class="af-refresh" data-af-refresh>↻ ${__('Refresh')}</button></div><div class="af-summary"><div class="af-summary-card"><span>${__('Pending workflow documents')}</span><strong>${summary.pending || 0}</strong></div><div class="af-summary-card"><span>${__('Overdue for 3+ days')}</span><strong>${summary.overdue || 0}</strong></div></div></div>
				<div class="af-toolbar"><input class="form-control" name="search" value="${escaped(state.filters.search || '')}" placeholder="${__('Search document ID')}" aria-label="${__('Search document ID')}"><select class="form-control" name="doctype" data-af-auto-filter><option value="">${__('All workflow document types')}</option>${doctypes.map((doctype) => `<option value="${escaped(doctype)}" ${state.filters.doctype === doctype ? 'selected' : ''}>${escaped(doctype)}</option>`).join('')}</select><select class="form-control" name="company" data-af-auto-filter><option value="">${__('All companies')}</option>${companies.map((company) => `<option value="${escaped(company)}" ${state.filters.company === company ? 'selected' : ''}>${escaped(company)}</option>`).join('')}</select><input class="form-control" name="from_date" data-af-auto-filter value="${escaped(state.filters.from_date || '')}" type="date" aria-label="${__('Created on or after')}"></div>
				<div class="af-heading"><div><h3>${__('Workflow monitoring queue')}</h3><p>${__('Grouped by the current state and the next possible transition. This page is read-only.')}</p></div><select class="af-sort" data-af-sort aria-label="${__('Sort workflow monitoring queue')}"><option value="creation:asc" ${selected_sort === 'creation:asc' ? 'selected' : ''}>${__('Created: oldest first')}</option><option value="creation:desc" ${selected_sort === 'creation:desc' ? 'selected' : ''}>${__('Created: newest first')}</option><option value="modified:desc" ${selected_sort === 'modified:desc' ? 'selected' : ''}>${__('Last modified: newest first')}</option><option value="modified:asc" ${selected_sort === 'modified:asc' ? 'selected' : ''}>${__('Last modified: oldest first')}</option></select></div>
				<nav class="af-tabs" aria-label="${__('Next workflow transitions')}">${tabs_html}</nav><div class="af-grid" data-af-results>${cards}</div>
			</section>`);

		const tab_scroller = $container.find('.af-tabs').get(0);
		if (tab_scroller) requestAnimationFrame(() => { tab_scroller.scrollLeft = state.tab_scroll_left; });
		if (state.restore_search_focus) {
			const search_input = $container.find('[name="search"]').get(0);
			if (search_input) requestAnimationFrame(() => {
				search_input.focus();
				search_input.setSelectionRange(Math.min(state.search_cursor, search_input.value.length), Math.min(state.search_cursor, search_input.value.length));
				state.restore_search_focus = false;
			});
		}
	}

	render();
	load_filter_options();
};
