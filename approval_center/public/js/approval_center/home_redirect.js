/* Redirect workflow approvers only when they arrive at the bare Desk home. */
(function () {
	function is_desk_home() {
		const route = window.location.pathname.replace(/\/+$/, '');
		return route === '/app' || route === '/desk';
	}

	function redirect_approvers_to_approval_center() {
		if (!frappe.boot || !frappe.boot.approval_center_home || !is_desk_home()) {
			return;
		}

		frappe.set_route('approval-center');
	}

	if (window.frappe && frappe.boot) {
		redirect_approvers_to_approval_center();
	} else {
		window.addEventListener('load', redirect_approvers_to_approval_center, { once: true });
	}
})();
