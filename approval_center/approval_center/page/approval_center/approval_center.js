frappe.pages['approval-center'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Approval Center'),
		single_column: true,
	});
	const $container = $(wrapper).find('.layout-main-section');
	const state = { selected_tab: '', data: { tabs: [], documents: [], summary: {} } };

	$container.on('click.approval-center', '[data-ac-action]', async function () {
		const button = this;
		const action = $(button).attr('data-ac-action');
		const doctype = $(button).attr('data-ac-doctype');
		const name = $(button).attr('data-ac-name');
		const requires_reason = ['reject', 'rejected', 'send back'].includes(action.toLowerCase());

		frappe.prompt(
			[
				{
					fieldname: 'comment',
					label: requires_reason ? __('Reason') : __('Comment (optional)'),
					fieldtype: 'Small Text',
					reqd: requires_reason,
				},
			],
			async (values) => {
				await frappe.call({
					method: 'approval_center.api.perform_workflow_action',
					args: { doctype, name, action, comment: values.comment },
					freeze: true,
					freeze_message: __('Applying {0}...', [action]),
				});
				frappe.show_alert({ message: __('{0} applied', [action]), indicator: 'green' });
				refresh();
			},
			__('Confirm {0}', [action]),
			__('Apply')
		);
	});

	$container.on('click.approval-center', '[data-ac-tab]', function () {
		state.selected_tab = $(this).attr('data-ac-tab');
		refresh();
	});

	$container.on('click.approval-center', '[data-ac-open]', function () {
		frappe.set_route('Form', $(this).attr('data-ac-doctype'), $(this).attr('data-ac-name'));
	});

	$container.on('click.approval-center', '[data-ac-refresh]', refresh);

	async function refresh() {
		$container.find('[data-ac-body]').html(`<div class="text-muted p-4">${__('Loading approvals...')}</div>`);
		try {
			const response = await frappe.call({
				method: 'approval_center.api.get_dashboard',
				args: { tab_key: state.selected_tab },
			});
			state.data = response.message;
			render();
		} catch (error) {
			console.error('Approval Center failed to load:', error);
			$container.find('[data-ac-body]').html(
				`<div class="alert alert-danger">${frappe.utils.escape_html(error.message || __('Could not load approvals.'))}</div>`
			);
		}
	}

	function render() {
		const { tabs, documents, summary } = state.data;
		const escaped = frappe.utils.escape_html;
		const tab_html = [
			`<button class="btn btn-sm ${state.selected_tab ? 'btn-default' : 'btn-primary'}" data-ac-tab="">${__('All pending')} <b>${summary.pending || 0}</b></button>`,
			...tabs.map((tab) => `<button class="btn btn-sm ${state.selected_tab === tab.key ? 'btn-primary' : 'btn-default'}" data-ac-tab="${escaped(tab.key)}">${escaped(tab.doctype)} · ${escaped(tab.state)} <b>${tab.count}</b></button>`),
		].join(' ');
		const cards = documents.length
			? documents.map((doc) => {
				const actions = doc.actions.map((action) => `<button class="btn btn-primary btn-xs" data-ac-action="${escaped(action)}" data-ac-doctype="${escaped(doc.doctype)}" data-ac-name="${escaped(doc.name)}">${escaped(action)}</button>`).join(' ');
				const amount = doc.amount ? format_currency(doc.amount, doc.currency) : '—';
				return `<div class="border rounded p-3 mb-3 bg-white">
					<div class="d-flex justify-content-between"><span class="indicator-pill blue">${escaped(doc.state)}</span><small class="text-muted">${frappe.datetime.comment_when(doc.creation)}</small></div>
					<h4 class="mt-3 mb-1">${escaped(doc.title || doc.name)}</h4>
					<div class="text-muted mb-3">${escaped(doc.doctype)} · ${escaped(doc.name)}</div>
					<div class="d-flex justify-content-between mb-3"><span>${escaped(doc.company || doc.owner || '')}</span><b>${amount}</b></div>
					<div class="d-flex gap-2 flex-wrap">${actions} <button class="btn btn-default btn-xs" data-ac-open data-ac-doctype="${escaped(doc.doctype)}" data-ac-name="${escaped(doc.name)}">${__('Open')}</button></div>
				</div>`;
			}).join('')
			: `<div class="text-muted text-center p-5">${__('Nothing is waiting for your approval.')}</div>`;

		$container.html(`
			<div class="mb-4 d-flex align-items-center gap-4">
				<div class="border rounded p-3"><small class="text-muted d-block">${__('Awaiting your action')}</small><b class="h3">${summary.pending || 0}</b></div>
				<div class="border rounded p-3"><small class="text-muted d-block">${__('Overdue (3+ days)')}</small><b class="h3 text-danger">${summary.overdue || 0}</b></div>
				<button class="btn btn-default btn-sm ml-auto" data-ac-refresh>${__('Refresh')}</button>
			</div>
			<div class="mb-4 d-flex gap-2 flex-wrap">${tab_html}</div>
			<div data-ac-body>${cards}</div>
		`);
	}

	render();
	refresh();
};
