import { createApp } from 'vue';
import ApprovalCenter from './ApprovalCenter.vue';
import './approval_center.css';

function setupApprovalCenter(wrapper) {
	const app = createApp(ApprovalCenter);
	app.mount(wrapper.get(0));
	return app;
}

window.frappe.ui.setup_approval_center = setupApprovalCenter;

export default setupApprovalCenter;
