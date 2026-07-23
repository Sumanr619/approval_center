<script setup>
import { computed, onMounted, reactive, ref } from 'vue';

const METHOD = 'approval_center.api';
const loading = ref(false);
const tabs = ref([]);
const rows = ref([]);
const selectedTab = ref('');
const selected = ref(null);
const details = ref(null);
const summary = reactive({ pending: 0, overdue: 0 });
const filters = reactive({ doctype: '', company: '', priority: '', from_date: '', to_date: '', min_amount: '', max_amount: '' });

const currentTab = computed(() => tabs.value.find((tab) => tab.key === selectedTab.value));

async function call(method, args = {}) {
	const response = await frappe.call({ method: `${METHOD}.${method}`, args, freeze: false });
	return response.message;
}

async function refresh() {
	loading.value = true;
	try {
		const data = await call('get_dashboard', { filters, tab_key: selectedTab.value });
		tabs.value = data.tabs;
		if (selectedTab.value && !tabs.value.some((tab) => tab.key === selectedTab.value)) selectedTab.value = '';
		rows.value = data.documents;
		Object.assign(summary, data.summary);
	} finally {
		loading.value = false;
	}
}

async function chooseTab(key) {
	selectedTab.value = key;
	await refresh();
}

async function showDetails(row) {
	selected.value = row;
	details.value = await call('get_document_details', { doctype: row.doctype, name: row.name });
}

function promptForAction(row, action) {
	const requiresReason = ['reject', 'rejected', 'send back'].includes(action.toLowerCase());
	frappe.prompt(
		[{ fieldname: 'comment', label: requiresReason ? __('Reason') : __('Comment (optional)'), fieldtype: 'Small Text', reqd: requiresReason }],
		async (values) => {
			await call('perform_workflow_action', { doctype: row.doctype, name: row.name, action, comment: values.comment });
			frappe.show_alert({ message: __('{0} applied', [action]), indicator: 'green' });
			selected.value = null;
			details.value = null;
			await refresh();
		},
		__('Confirm {0}', [action]),
		__('Apply')
	);
}

function openDocument(row) {
	frappe.set_route('Form', row.doctype, row.name);
}

function formatMoney(row) {
	return row.amount ? format_currency(row.amount, row.currency) : '—';
}

function age(creation) {
	return frappe.datetime.comment_when(creation);
}

onMounted(refresh);
</script>

<template>
	<section class="approval-center">
		<div class="ac-summary">
			<div><span>{{ __('Awaiting your action') }}</span><strong>{{ summary.pending }}</strong></div>
			<div><span>{{ __('Overdue (3+ days)') }}</span><strong class="text-danger">{{ summary.overdue }}</strong></div>
			<button class="btn btn-default btn-sm" :disabled="loading" @click="refresh">{{ __('Refresh') }}</button>
		</div>

		<div class="ac-filters">
			<input v-model="filters.doctype" class="form-control" :placeholder="__('Document Type')" @change="refresh">
			<input v-model="filters.company" class="form-control" :placeholder="__('Company')" @change="refresh">
			<input v-model="filters.priority" class="form-control" :placeholder="__('Priority')" @change="refresh">
			<input v-model="filters.from_date" type="date" class="form-control" @change="refresh">
			<input v-model="filters.to_date" type="date" class="form-control" @change="refresh">
			<input v-model="filters.min_amount" type="number" class="form-control" :placeholder="__('Min. amount')" @change="refresh">
		</div>

		<nav class="ac-tabs">
			<button :class="{ active: !selectedTab }" @click="chooseTab('')">{{ __('All pending') }} <b>{{ summary.pending }}</b></button>
			<button v-for="tab in tabs" :key="tab.key" :class="{ active: selectedTab === tab.key }" @click="chooseTab(tab.key)">
				{{ tab.doctype }} · {{ tab.state }} <b>{{ tab.count }}</b>
			</button>
		</nav>

		<div v-if="loading" class="text-muted p-4">{{ __('Loading approvals…') }}</div>
		<div v-else-if="!rows.length" class="ac-empty">{{ __('Nothing is waiting for your approval.') }}</div>
		<div v-else class="ac-grid">
			<article v-for="row in rows" :key="`${row.doctype}-${row.name}`" class="ac-card" @click="showDetails(row)">
				<div class="ac-card-top"><span class="indicator-pill blue">{{ row.state }}</span><small>{{ age(row.creation) }}</small></div>
				<h4>{{ row.title || row.name }}</h4>
				<p>{{ row.doctype }} · {{ row.name }}</p>
				<div class="ac-meta"><span>{{ row.company || row.owner }}</span><strong>{{ formatMoney(row) }}</strong></div>
				<div class="ac-actions" @click.stop>
					<button v-for="action in row.actions" :key="action" class="btn btn-primary btn-xs" @click="promptForAction(row, action)">{{ action }}</button>
				</div>
			</article>
		</div>

		<aside v-if="selected && details" class="ac-drawer">
			<button class="close" @click="selected = null; details = null">×</button>
			<h3>{{ details.title }}</h3><p class="text-muted">{{ selected.doctype }} · {{ selected.name }}</p>
			<dl><template v-for="field in details.fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></template></dl>
			<div class="ac-actions">
				<button v-for="action in details.actions" :key="action" class="btn btn-primary" @click="promptForAction(selected, action)">{{ action }}</button>
				<button class="btn btn-default" @click="openDocument(selected)">{{ __('Open document') }}</button>
			</div>
		</aside>
	</section>
</template>
