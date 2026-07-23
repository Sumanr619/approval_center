frappe.pages['approval-center'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Approval Center'),
		single_column: true,
	});
};

frappe.pages['approval-center'].on_page_show = function (wrapper) {
	load_approval_center(wrapper);
};

async function load_approval_center(wrapper) {
	const $container = $(wrapper).find('.layout-main-section');
	$container.html('<div class="text-muted p-4">Loading Approval Center…</div>');

	try {
		await frappe.require('approval_center.bundle.js');

		if (!window.frappe.ui.setup_approval_center) {
			throw new Error('The Approval Center bundle loaded, but setup_approval_center was not found.');
		}

		$container.empty();
		frappe.approval_center_app?.unmount?.();
		frappe.approval_center_app = window.frappe.ui.setup_approval_center($container);
	} catch (error) {
		console.error('Approval Center failed to load:', error);
		$container.html(`
			<div class="alert alert-danger m-4">
				<b>Approval Center could not load.</b><br><br>
				${frappe.utils.escape_html(error.message || String(error))}
			</div>
		`);
	}
}
