frappe.pages['approval-center'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: __('Approval Center'), single_column: true });

	const $container = $(wrapper).find('.layout-main-section');
	const state = {
		selected_tab: '',
		filters: {},
		filter_options: { doctypes: [], companies: [], default_company: null },
		data: { tabs: [], documents: [], summary: { pending: 0, overdue: 0 } },
		workflow_summary: { rows: [], total_pending: 0, total_overdue: 0 },
	};

	$container.on('click.approval-center', '[data-ac-tab]', function () {
		state.selected_tab = $(this).attr('data-ac-tab');
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-filter]', function () {
		state.filters = {
			doctype: $container.find('[name="doctype"]').val().trim(),
			company: $container.find('[name="company"]').val().trim(),
			from_date: $container.find('[name="from_date"]').val(),
		};
		state.selected_tab = '';
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-refresh]', refresh);

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
					args: { tab_key: state.selected_tab, filters: state.filters },
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
		const tab_html = [
			`<button class="ac-tab ${state.selected_tab ? '' : 'active'}" data-ac-tab=""><span>${__('All approvals')}</span><b>${summary.pending || 0}</b></button>`,
			...tabs.map((tab) => `<button class="ac-tab ${state.selected_tab === tab.key ? 'active' : ''}" data-ac-tab="${escaped(tab.key)}"><span>${escaped(tab.doctype)} <em>·</em> ${escaped(tab.state)}</span><b>${tab.count}</b></button>`),
		].join('');
		const backlog_rows = workflow_summary.rows.length
			? workflow_summary.rows.map((row) => `<tr><td>${escaped(row.doctype)}</td><td>${escaped(row.state)}</td><td><b>${row.pending}</b></td><td>${row.overdue}</td></tr>`).join('')
			: `<tr><td colspan="4" class="ac-summary-empty">${__('No pending workflow documents match the selected filters.')}</td></tr>`;

		const cards = documents.length ? documents.map((doc) => {
			const action_buttons = doc.actions.map((action) => `<button class="btn btn-primary btn-sm" data-ac-action="${escaped(action)}" data-ac-doctype="${escaped(doc.doctype)}" data-ac-name="${escaped(doc.name)}">${escaped(action)}</button>`).join('');
			const amount = doc.amount ? format_currency(doc.amount, doc.currency) : __('Not applicable');
			return `<article class="ac-card">
				<div class="ac-card-head"><span class="ac-state">${escaped(doc.state)}</span><span class="ac-age">${frappe.datetime.comment_when(doc.creation)}</span></div>
				<div class="ac-card-body">
					<p class="ac-doc-type">${escaped(doc.doctype)}</p>
					<h3>${escaped(doc.title || doc.name)}</h3>
					<p class="ac-document-id">${escaped(doc.name)}</p>
					<div class="ac-divider"></div>
					<div class="ac-details"><span>${escaped(doc.company || doc.owner || __('Unassigned'))}</span><strong>${amount}</strong></div>
				</div>
				<div class="ac-card-actions">${action_buttons}<button class="btn btn-default btn-sm" data-ac-open data-ac-doctype="${escaped(doc.doctype)}" data-ac-name="${escaped(doc.name)}">${__('Review')}</button></div>
			</article>`;
		}).join('') : `<div class="ac-empty"><div class="ac-empty-icon">✓</div><h3>${__('You are all caught up')}</h3><p>${__('There are no documents waiting for your approval with the selected filters.')}</p></div>`;

		$container.html(`
			<style>
				.approval-center { color: #172b4d; max-width: 1440px; margin: 0 auto; padding-bottom: 36px; }
				.ac-hero { border-radius: 18px; color: #fff; padding: 28px 30px; margin-bottom: 22px; background: linear-gradient(120deg, #172b4d 0%, #1f4b84 60%, #1b6b8e 100%); box-shadow: 0 12px 30px rgba(31,75,132,.18); }
				.ac-hero-top, .ac-card-head, .ac-details, .ac-card-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
				.ac-kicker { margin: 0 0 6px; color: #a9d8ff; font-size: 12px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase; }
				.ac-hero h2 { margin: 0; color: #fff; font-size: 27px; font-weight: 700; }.ac-hero p { margin: 8px 0 0; color: #d9e9f8; }
				.ac-refresh { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.28); color: #fff; border-radius: 8px; padding: 8px 14px; }.ac-refresh:hover { background: rgba(255,255,255,.24); color: #fff; }
				.ac-backlog { margin-top: 24px; overflow: hidden; border: 1px solid rgba(255,255,255,.2); border-radius: 12px; background: rgba(5,31,67,.18); }.ac-backlog-title { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,.14); }.ac-backlog-title b { font-size: 14px; }.ac-backlog-title span { color: #d9e9f8; font-size: 12px; }.ac-backlog-table { width: 100%; border-collapse: collapse; color: #fff; }.ac-backlog-table th, .ac-backlog-table td { padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.1); text-align: left; font-size: 13px; }.ac-backlog-table th { color: #b8dcfb; font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }.ac-backlog-table tr:last-child td { border-bottom: 0; }.ac-summary-empty { color: #d9e9f8; text-align: center !important; }
				.ac-toolbar { display: grid; grid-template-columns: 1.2fr 1.2fr 170px auto; gap: 10px; padding: 16px; margin-bottom: 18px; background: #fff; border: 1px solid #e5eaf0; border-radius: 14px; box-shadow: 0 4px 14px rgba(19,45,83,.05); }.ac-toolbar .form-control { height: 38px; border-radius: 8px; }.ac-toolbar .btn { border-radius: 8px; }
				.ac-queue-heading { margin: 25px 0 12px; }.ac-queue-heading h3 { margin: 0; color: #1d3557; font-size: 18px; }.ac-queue-heading p { margin: 3px 0 0; color: #718096; font-size: 13px; }
				.ac-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 14px; margin-bottom: 6px; }.ac-tab { white-space: nowrap; border: 1px solid #dfe6ee; background: #fff; color: #52667f; border-radius: 20px; padding: 7px 11px 7px 13px; font-size: 12px; }.ac-tab b { display: inline-block; min-width: 20px; padding: 1px 6px; margin-left: 7px; background: #eef2f7; border-radius: 10px; color: #334e68; }.ac-tab em { color: #9fb1c3; font-style: normal; }.ac-tab.active { background: #e8f3ff; color: #175f9e; border-color: #b5dbfb; font-weight: 600; }.ac-tab.active b { background: #fff; color: #175f9e; }
				.ac-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(305px, 1fr)); gap: 16px; }.ac-card { overflow: hidden; border: 1px solid #e3e8ef; border-radius: 14px; background: #fff; box-shadow: 0 4px 14px rgba(19,45,83,.05); transition: transform .15s ease, box-shadow .15s ease; }.ac-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(19,45,83,.11); }.ac-card-head { padding: 14px 16px 0; }.ac-state { max-width: 72%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 9px; border-radius: 20px; color: #175f9e; background: #e8f3ff; font-size: 11px; font-weight: 700; }.ac-age { color: #8494a7; font-size: 12px; }.ac-card-body { padding: 18px 16px 14px; }.ac-doc-type { margin: 0 0 6px; color: #68809a; font-size: 12px; font-weight: 600; }.ac-card h3 { min-height: 25px; margin: 0; overflow: hidden; color: #1d3557; font-size: 17px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }.ac-document-id { margin: 5px 0 0; color: #8394a8; font-size: 12px; }.ac-divider { height: 1px; margin: 18px 0 12px; background: #edf0f4; }.ac-details { color: #5d7087; font-size: 13px; }.ac-details span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.ac-details strong { color: #1d3557; white-space: nowrap; }.ac-card-actions { justify-content: flex-start; flex-wrap: wrap; padding: 13px 16px; border-top: 1px solid #edf0f4; background: #fbfcfe; }.ac-card-actions .btn { border-radius: 7px; }
				.ac-empty { padding: 64px 24px; text-align: center; border: 1px dashed #cfd9e5; border-radius: 14px; background: #fff; }.ac-empty-icon { display: grid; place-items: center; width: 44px; height: 44px; margin: auto auto 12px; border-radius: 50%; background: #e7f7ef; color: #16844a; font-weight: 800; font-size: 21px; }.ac-empty h3 { margin: 0 0 6px; font-size: 18px; }.ac-empty p { margin: 0; color: #718096; }.ac-error { padding: 18px; color: #a61b1b; border: 1px solid #ffcccc; border-radius: 10px; background: #fff5f5; }.ac-loading { opacity: .55; pointer-events: none; }
				@media (max-width: 700px) { .ac-hero { padding: 22px 18px; }.ac-hero-top { align-items: flex-start; }.ac-hero h2 { font-size: 23px; }.ac-backlog { overflow-x: auto; }.ac-backlog-table { min-width: 580px; }.ac-toolbar { grid-template-columns: 1fr; }.ac-grid { grid-template-columns: 1fr; } }
			</style>
			<section class="approval-center">
				<div class="ac-hero"><div class="ac-hero-top"><div><div class="ac-kicker">${__('Workflow workspace')}</div><h2>${__('Workflow backlog')}</h2><p>${__('All visible documents at pending workflow stages, regardless of the next approver role.')}</p></div><button class="ac-refresh" data-ac-refresh>↻ ${__('Refresh')}</button></div><div class="ac-backlog"><div class="ac-backlog-title"><b>${__('Pending workflow documents')}</b><span>${__('Total')}: <strong>${workflow_summary.total_pending}</strong> &nbsp; · &nbsp; ${__('Overdue 3+ days')}: <strong>${workflow_summary.total_overdue}</strong></span></div><table class="ac-backlog-table"><thead><tr><th>${__('Document Type')}</th><th>${__('Workflow Stage')}</th><th>${__('Pending')}</th><th>${__('Overdue')}</th></tr></thead><tbody>${backlog_rows}</tbody></table></div></div>
				<div class="ac-toolbar">
					<select class="form-control" name="doctype"><option value="">${__('All workflow document types')}</option>${doctypes.map((doctype) => `<option value="${escaped(doctype)}" ${state.filters.doctype === doctype ? 'selected' : ''}>${escaped(doctype)}</option>`).join('')}</select>
					<select class="form-control" name="company"><option value="">${__('All companies')}</option>${companies.map((company) => `<option value="${escaped(company)}" ${state.filters.company === company ? 'selected' : ''}>${escaped(company)}</option>`).join('')}</select>
					<input class="form-control" name="from_date" value="${escaped(state.filters.from_date || '')}" type="date" aria-label="${__('Created on or after')}">
					<button class="btn btn-primary" data-ac-filter>${__('Apply filters')}</button>
				</div>
				<div class="ac-queue-heading"><h3>${__('My approval queue')}</h3><p>${__('Documents you can act on now, based on your workflow role and permissions.')}</p></div>
				<nav class="ac-tabs" aria-label="${__('Approval states')}">${tab_html}</nav>
				<div class="ac-grid" data-ac-results>${cards}</div>
			</section>
		`);
	}

	render();
	load_filter_options();
};
