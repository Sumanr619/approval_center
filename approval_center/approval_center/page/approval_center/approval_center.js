frappe.pages['approval-center'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: __('Approval Center'), single_column: true });

	const $container = $(wrapper).find('.layout-main-section');
	const state = {
		selected_tab: '',
		filters: {},
		filter_options: { doctypes: [], companies: [], default_company: null },
		data: { tabs: [], documents: [], summary: { pending: 0, overdue: 0 } },
		workflow_summary: { rows: [], total_pending: 0, total_overdue: 0 },
		sort_by: 'creation',
		sort_order: 'asc',
		tab_scroll_left: 0,
	};

	$container.on('click.approval-center', '[data-ac-tab]', function () {
		const tab_scroller = $(this).closest('.ac-tabs').get(0);
		state.tab_scroll_left = tab_scroller ? tab_scroller.scrollLeft : 0;
		state.selected_tab = $(this).attr('data-ac-tab');
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-summary-doctype]', function () {
		state.filters = {
			...state.filters,
			doctype: $(this).attr('data-ac-summary-doctype'),
		};
		state.selected_tab = '';
		state.tab_scroll_left = 0;
		refresh();
	});

	$container.on('change.approval-center', '[data-ac-auto-filter]', function () {
		state.filters = {
			doctype: $container.find('[name="doctype"]').val().trim(),
			company: $container.find('[name="company"]').val().trim(),
			from_date: $container.find('[name="from_date"]').val(),
		};
		state.selected_tab = '';
		state.tab_scroll_left = 0;
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-refresh]', function () {
		state.filters = { ...state.filters, doctype: '' };
		state.selected_tab = '';
		state.tab_scroll_left = 0;
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-clear-doctype]', function () {
		state.filters = { ...state.filters, doctype: '' };
		state.selected_tab = '';
		state.tab_scroll_left = 0;
		refresh();
	});

	$container.on('change.approval-center', '[data-ac-sort]', function () {
		const [sort_by, sort_order] = $(this).val().split(':');
		state.sort_by = sort_by;
		state.sort_order = sort_order;
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-open]', function () {
		frappe.set_route('Form', $(this).attr('data-ac-doctype'), $(this).attr('data-ac-name'));
	});

	$container.on('click.approval-center', '[data-ac-action]', function () {
		const $button = $(this);
		const action = $button.attr('data-ac-action');
		const requires_reason = ['reject', 'rejected', 'send back'].includes(action.toLowerCase());

		frappe.prompt(
			[{
				fieldname: 'comment',
				label: requires_reason ? __('Rejection reason') : __('Comment (optional)'),
				fieldtype: 'Small Text',
				reqd: requires_reason,
			}],
			async (values) => {
				try {
					await frappe.call({
						method: 'approval_center.api.perform_workflow_action',
						args: {
							doctype: $button.attr('data-ac-doctype'),
							name: $button.attr('data-ac-name'),
							action,
							comment: values.comment,
						},
						freeze: true,
						freeze_message: __('Applying {0}...', [action]),
					});
					frappe.show_alert({ message: __('{0} applied successfully', [action]), indicator: 'green' });
					refresh();
				} catch (error) {
					frappe.msgprint({ title: __('Action not applied'), message: error.message, indicator: 'red' });
				}
			},
			__('Confirm {0}', [action]),
			__('Apply action')
		);
	});

	async function refresh() {
		$container.find('[data-ac-results]').addClass('ac-loading');
		try {
			const [queue_response, workflow_response] = await Promise.all([
				frappe.call({
					method: 'approval_center.api.get_dashboard',
					args: {
						tab_key: state.selected_tab,
						filters: state.filters,
						sort_by: state.sort_by,
						sort_order: state.sort_order,
					},
				}),
				frappe.call({
					method: 'approval_center.api.get_workflow_summary',
					args: { filters: state.filters },
				}),
			]);
			state.data = queue_response.message;
			state.workflow_summary = workflow_response.message;
			render();
		} catch (error) {
			console.error('Approval Center failed to load:', error);
			$container.find('[data-ac-results]').html(`
				<div class="ac-error"><b>${__('Approval Center could not load')}</b><br>${frappe.utils.escape_html(error.message || __('Please contact your system administrator.'))}</div>
			`);
		}
	}

	async function load_filter_options() {
		try {
			const response = await frappe.call({ method: 'approval_center.api.get_filter_options' });
			state.filter_options = response.message;
			if (!state.filters.company && state.filter_options.default_company) {
				state.filters.company = state.filter_options.default_company;
			}
		} catch (error) {
			console.error('Approval Center filter options failed to load:', error);
		}
		render();
		refresh();
	}

	function render() {
		const escaped = frappe.utils.escape_html;
		const { tabs, documents, summary } = state.data;
		const workflow_summary = state.workflow_summary;
		const { doctypes, companies } = state.filter_options;
		const largest_tab_count = Math.max(
			1,
			Number(summary.pending) || 0,
			...tabs.map((tab) => Number(tab.count) || 0),
		);
		const tab_tone = (count) => {
			// A square-root scale makes smaller queues visibly different too,
			// while keeping the largest queue clearly darkest.
			const intensity = Math.sqrt(Math.max(Number(count) || 0, 0) / largest_tab_count);
			const lightness = Math.round(96 - intensity * 52);
			const text_color = lightness < 64 ? '#ffffff' : '#173b66';
			const badge_background = lightness < 64 ? 'rgba(255,255,255,.24)' : 'rgba(255,255,255,.82)';

			return `style="--ac-tab-background:hsl(211 72% ${lightness}%);--ac-tab-border:hsl(211 65% ${Math.max(lightness - 8, 28)}%);--ac-tab-text:${text_color};--ac-tab-badge-background:${badge_background};--ac-tab-badge-text:${text_color}"`;
		};
		const tab_html = [
			`<button class="ac-tab ${state.selected_tab ? '' : 'active'}" data-ac-tab="" ${tab_tone(summary.pending)}><span>${__('All approvals')}</span><b>${summary.pending || 0}</b></button>`,
			...tabs.map((tab) => `<button class="ac-tab ${state.selected_tab === tab.key ? 'active' : ''}" data-ac-tab="${escaped(tab.key)}" ${tab_tone(tab.count)}><span>${escaped(tab.doctype)} <em>·</em> ${escaped(tab.state)}</span><b>${tab.count}</b></button>`),
		].join('');
		const backlog_by_doctype = workflow_summary.rows.reduce((totals, row) => {
			if (!totals[row.doctype]) totals[row.doctype] = { doctype: row.doctype, pending: 0, overdue: 0 };
			totals[row.doctype].pending += row.pending;
			totals[row.doctype].overdue += row.overdue;
			return totals;
		}, {});
		const backlog_cards = Object.values(backlog_by_doctype).length
			? Object.values(backlog_by_doctype).map((item) => `<button class="ac-summary-card" data-ac-summary-doctype="${escaped(item.doctype)}"><span>${escaped(item.doctype)}</span><strong>${item.pending}</strong><small>${__('pending')} · ${item.overdue} ${__('overdue')}</small></button>`).join('')
			: `<div class="ac-summary-empty">${__('No pending workflow documents match the selected filters.')}</div>`;
		const clear_document_type = state.filters.doctype
			? `<button class="ac-clear-type" data-ac-clear-doctype>← ${__('All document types')}</button>`
			: '';
		const selected_sort = `${state.sort_by}:${state.sort_order}`;

		const cards = documents.length ? documents.map((doc) => {
			const action_buttons = doc.actions.map((action) => `<button class="btn btn-primary btn-sm" data-ac-action="${escaped(action)}" data-ac-doctype="${escaped(doc.doctype)}" data-ac-name="${escaped(doc.name)}">${escaped(action)}</button>`).join('');
			const document_id = doc.title && doc.title !== doc.name
				? `<p class="ac-document-id">${escaped(doc.name)}</p>`
				: '';
			const card_details = (doc.card_details || []).map((detail) => {
				const value = detail.kind === 'currency'
					? format_currency(detail.value, detail.currency || doc.currency)
					: detail.value;
				return `<div class="ac-detail ${detail.kind === 'currency' ? 'ac-detail-currency' : ''}"><small>${escaped(detail.label)}</small><strong>${escaped(String(value))}</strong></div>`;
			}).join('');
			const detail_section = card_details
				? `<div class="ac-divider"></div><div class="ac-details">${card_details}</div>`
				: '';
			return `<article class="ac-card">
				<div class="ac-card-head"><span class="ac-state">${escaped(doc.state)}</span><span class="ac-age">${frappe.datetime.comment_when(doc.creation)}</span></div>
				<div class="ac-card-body">
					<p class="ac-doc-type">${escaped(doc.doctype)}</p>
					<h3>${escaped(doc.title || doc.name)}</h3>
					${document_id}
					${detail_section}
				</div>
				<div class="ac-card-actions">${action_buttons}<button class="btn btn-default btn-sm" data-ac-open data-ac-doctype="${escaped(doc.doctype)}" data-ac-name="${escaped(doc.name)}">${__('Review')}</button></div>
			</article>`;
		}).join('') : `<div class="ac-empty"><div class="ac-empty-icon">✓</div><h3>${__('You are all caught up')}</h3><p>${__('There are no documents waiting for your approval with the selected filters.')}</p></div>`;

		$container.html(`
			<style>
				.approval-center { color: #172b4d; max-width: 1440px; margin: 0 auto; padding-bottom: 36px; }
				.ac-hero { border-radius: 18px; color: #fff; padding: 28px 30px; margin-bottom: 22px; background: linear-gradient(120deg, #172b4d 0%, #1f4b84 60%, #1b6b8e 100%); box-shadow: 0 12px 30px rgba(31,75,132,.18); }
				.ac-hero-top, .ac-card-head, .ac-card-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
				.ac-kicker { margin: 0 0 6px; color: #a9d8ff; font-size: 12px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
				.ac-hero h2 { margin: 0; color: #fff; font-size: 27px; font-weight: 700; }.ac-hero p { margin: 8px 0 0; color: #d9e9f8; }
				.ac-refresh { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.28); color: #fff; border-radius: 8px; padding: 8px 14px; }.ac-refresh:hover { background: rgba(255,255,255,.24); color: #fff; }
				.ac-backlog { margin-top: 24px; }.ac-backlog-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 11px; }.ac-backlog-title b { font-size: 14px; }.ac-backlog-title span { color: #d9e9f8; font-size: 12px; }.ac-clear-type { padding: 4px 9px; color: #d9e9f8; border: 1px solid rgba(255,255,255,.3); border-radius: 7px; background: transparent; font-size: 11px; }.ac-clear-type:hover { color: #fff; background: rgba(255,255,255,.12); }.ac-summary-cards { display: flex; gap: 12px; overflow-x: auto; padding: 2px 0 5px; }.ac-summary-card { flex: 0 0 195px; min-height: 92px; padding: 13px 15px; color: #fff; border: 1px solid rgba(255,255,255,.2); border-radius: 12px; background: rgba(255,255,255,.12); text-align: left; transition: background .15s ease, transform .15s ease; }.ac-summary-card:hover { background: rgba(255,255,255,.22); transform: translateY(-1px); }.ac-summary-card span { display: block; overflow: hidden; color: #dceeff; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.ac-summary-card strong { display: block; margin: 5px 0 1px; font-size: 28px; line-height: 1; }.ac-summary-card small { color: #c9e2f8; font-size: 11px; }.ac-summary-empty { width: 100%; padding: 18px; color: #d9e9f8; border: 1px dashed rgba(255,255,255,.3); border-radius: 10px; text-align: center; }
				.ac-toolbar { display: grid; grid-template-columns: 1.2fr 1.2fr 170px; gap: 10px; padding: 16px; margin-bottom: 18px; background: #fff; border: 1px solid #e5eaf0; border-radius: 14px; box-shadow: 0 4px 14px rgba(19,45,83,.05); }.ac-toolbar .form-control { height: 38px; border-radius: 8px; }
				.ac-queue-heading { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin: 25px 0 12px; }.ac-queue-heading h3 { margin: 0; color: #1d3557; font-size: 18px; }.ac-queue-heading p { margin: 3px 0 0; color: #718096; font-size: 13px; }.ac-sort { min-width: 210px; height: 34px; border: 1px solid #dce4ec; border-radius: 8px; color: #43566c; background: #fff; font-size: 12px; }
				.ac-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 14px; margin-bottom: 6px; }.ac-tab { white-space: nowrap; border: 1px solid var(--ac-tab-border, #dfe6ee); background: var(--ac-tab-background, #fff); color: var(--ac-tab-text, #52667f); border-radius: 20px; padding: 7px 11px 7px 13px; font-size: 12px; transition: transform .15s ease, box-shadow .15s ease; }.ac-tab:hover { transform: translateY(-1px); }.ac-tab b { display: inline-block; min-width: 20px; padding: 1px 6px; margin-left: 7px; background: var(--ac-tab-badge-background, #eef2f7); border-radius: 10px; color: var(--ac-tab-badge-text, #334e68); font-weight: 800; }.ac-tab em { color: currentColor; opacity: .68; font-style: normal; }.ac-tab.active { border-color: #0d6db8; box-shadow: 0 0 0 2px rgba(13,109,184,.2); font-weight: 700; }
				.ac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(305px, 1fr)); gap: 16px; }.ac-card { overflow: hidden; border: 1px solid #e3e8ef; border-radius: 14px; background: #fff; box-shadow: 0 4px 14px rgba(19,45,83,.05); transition: transform .15s ease, box-shadow .15s ease; }.ac-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(19,45,83,.11); }.ac-card-head { padding: 14px 16px 0; }.ac-state { max-width: 72%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 9px; border-radius: 20px; color: #175f9e; background: #e8f3ff; font-size: 11px; font-weight: 700; }.ac-age { color: #8494a7; font-size: 12px; }.ac-card-body { padding: 18px 16px 14px; }.ac-doc-type { margin: 0 0 6px; color: #68809a; font-size: 12px; font-weight: 600; }.ac-card h3 { min-height: 25px; margin: 0; overflow: hidden; color: #1d3557; font-size: 17px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }.ac-document-id { margin: 5px 0 0; color: #8394a8; font-size: 12px; }.ac-divider { height: 1px; margin: 18px 0 12px; background: #edf0f4; }.ac-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }.ac-detail { min-width: 0; color: #5d7087; }.ac-detail small { display: block; margin-bottom: 3px; overflow: hidden; color: #8494a7; font-size: 10px; font-weight: 700; letter-spacing: .35px; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }.ac-detail strong { display: block; overflow: hidden; color: #1d3557; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }.ac-detail-currency { text-align: right; }.ac-card-actions { justify-content: flex-start; flex-wrap: wrap; padding: 13px 16px; border-top: 1px solid #edf0f4; background: #fbfcfe; }.ac-card-actions .btn { border-radius: 7px; }
				.ac-empty { padding: 64px 24px; text-align: center; border: 1px dashed #cfd9e5; border-radius: 14px; background: #fff; }.ac-empty-icon { display: grid; place-items: center; width: 44px; height: 44px; margin: auto auto 12px; border-radius: 50%; background: #e7f7ef; color: #16844a; font-weight: 800; font-size: 21px; }.ac-empty h3 { margin: 0 0 6px; font-size: 18px; }.ac-empty p { margin: 0; color: #718096; }.ac-error { padding: 18px; color: #a61b1b; border: 1px solid #ffcccc; border-radius: 10px; background: #fff5f5; }.ac-loading { opacity: .55; pointer-events: none; }
				@media (max-width: 700px) { .ac-hero { padding: 22px 18px; }.ac-hero-top { align-items: flex-start; }.ac-hero h2 { font-size: 23px; }.ac-toolbar { grid-template-columns: 1fr; }.ac-queue-heading { align-items: stretch; flex-direction: column; }.ac-sort { width: 100%; }.ac-grid { grid-template-columns: 1fr; } }
			</style>
			<section class="approval-center">
				<div class="ac-hero"><div class="ac-hero-top"><div><div class="ac-kicker">${__('Workflow workspace')}</div><h2>${__('Workflow backlog')}</h2><p>${__('Documents you can act on now, grouped by document type.')}</p></div><button class="ac-refresh" data-ac-refresh>↻ ${__('Refresh all')}</button></div><div class="ac-backlog"><div class="ac-backlog-title"><b>${__('My pending approvals by document type')}</b><span>${clear_document_type} &nbsp; ${__('Total')}: <strong>${workflow_summary.total_pending}</strong> &nbsp; · &nbsp; ${__('Overdue 3+ days')}: <strong>${workflow_summary.total_overdue}</strong></span></div><div class="ac-summary-cards">${backlog_cards}</div></div></div>
				<div class="ac-toolbar">
					<select class="form-control" name="doctype" data-ac-auto-filter><option value="">${__('All workflow document types')}</option>${doctypes.map((doctype) => `<option value="${escaped(doctype)}" ${state.filters.doctype === doctype ? 'selected' : ''}>${escaped(doctype)}</option>`).join('')}</select>
					<select class="form-control" name="company" data-ac-auto-filter><option value="">${__('All companies')}</option>${companies.map((company) => `<option value="${escaped(company)}" ${state.filters.company === company ? 'selected' : ''}>${escaped(company)}</option>`).join('')}</select>
					<input class="form-control" name="from_date" data-ac-auto-filter value="${escaped(state.filters.from_date || '')}" type="date" aria-label="${__('Created on or after')}">
				</div>
				<div class="ac-queue-heading"><div><h3>${__('My approval queue')}</h3><p>${__('Documents you can act on now, based on your workflow role and permissions.')}</p></div><select class="ac-sort" data-ac-sort aria-label="${__('Sort approval queue')}"><option value="creation:asc" ${selected_sort === 'creation:asc' ? 'selected' : ''}>${__('Created: oldest first')}</option><option value="creation:desc" ${selected_sort === 'creation:desc' ? 'selected' : ''}>${__('Created: newest first')}</option><option value="modified:desc" ${selected_sort === 'modified:desc' ? 'selected' : ''}>${__('Last modified: newest first')}</option><option value="modified:asc" ${selected_sort === 'modified:asc' ? 'selected' : ''}>${__('Last modified: oldest first')}</option></select></div>
				<nav class="ac-tabs" aria-label="${__('Approval states')}">${tab_html}</nav>
				<div class="ac-grid" data-ac-results>${cards}</div>
			</section>
		`);

		// Rendering replaces the tab bar. Restore its position after layout so a
		// click on a tab at the right does not send the user back to the first tab.
		const tab_scroller = $container.find('.ac-tabs').get(0);
		if (tab_scroller) {
			requestAnimationFrame(() => {
				tab_scroller.scrollLeft = state.tab_scroll_left;
			});
		}
	}

	render();
	load_filter_options();
};
