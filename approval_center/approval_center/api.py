"""Permission-safe API used by the Approval Center Desk page."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.model.workflow import get_transitions, has_approval_access, apply_workflow
from frappe.utils import cint, get_datetime, now_datetime


# Keep this aligned with the labels used in your Workflow Transition records.
REJECTION_ACTIONS = {"reject", "rejected", "send back"}
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
TOTAL_FIELDS = ("grand_total", "rounded_total", "total", "net_total")
DUE_DATE_FIELDS = (
    "required_by",
    "required_date",
    "due_date",
    "payment_due_date",
    "schedule_date",
    "delivery_date",
    "expected_delivery_date",
)
CARD_TITLE_FIELDS = (
    "customer_name",
    "supplier_name",
    "applicant_name",
    "employee_name",
    "party_name",
    "borrower_name",
    "requester_name",
    "customer",
    "supplier",
    "applicant",
    "employee",
    "party",
    "loan_applicant",
    "project_name",
    "project",
    "subject",
)
CARD_DETAIL_FIELDS = (
    "company",
    "department",
    "branch",
    "cost_center",
    "project",
    "customer_name",
    "supplier_name",
    "applicant_name",
    "employee_name",
    "party_name",
    "customer",
    "supplier",
    "applicant",
    "employee",
    "party",
    "requester_name",
    "requested_by",
    "sales_person_name",
    "sales_person",
    "salesperson",
    "contact_person",
)
IDENTITY_KEYWORDS = ("customer", "supplier", "applicant", "employee", "borrower", "client", "party", "requester")
CARD_FIELD_TYPES = {"Data", "Link", "Dynamic Link", "Select", "Read Only"}
FOLLOW_UP_ROLES = {"Approval Follow-up", "System Manager"}


def _has_read_permission_silently(doctype_or_doc):
    """Check access without retaining Frappe's explanatory permission messages.

    Some deployed Frappe releases expose different keyword arguments on
    ``has_permission``. Keeping the temporary message log isolated works with
    all of them and prevents unrelated denied DocTypes from showing a modal.
    """
    original_message_log = frappe.local.message_log
    frappe.local.message_log = []
    try:
        return frappe.has_permission(doctype_or_doc, "read")
    finally:
        frappe.local.message_log = original_message_log


def _parse_filters(filters):
    filters = frappe.parse_json(filters) if filters else {}
    return frappe._dict(filters)


def _workflow_state_docstatuses(doctype, state_docstatus_cache):
    """Return a cached map of workflow state to its configured docstatus."""
    if doctype not in state_docstatus_cache:
        workflow_names = frappe.get_all(
            "Workflow",
            filters={"document_type": doctype, "is_active": 1},
            pluck="name",
        )
        workflow_states = (
            frappe.get_all(
                "Workflow Document State",
                filters={"parent": ["in", workflow_names]},
                fields=["state", "doc_status"],
            )
            if workflow_names
            else []
        )
        state_docstatus_cache[doctype] = {
            state.state: cint(state.doc_status)
            for state in workflow_states
        }
    return state_docstatus_cache[doctype]


def _has_only_docstatus_two_transitions(doc, transitions, state_docstatus_cache):
    """Return true for an optional post-submit cancellation-only workflow step.

    A document already at docstatus 1 is complete from the normal business
    process perspective. If every action still available to the user only moves
    it to a state with docstatus 2, that action is optional and should not be
    shown as a pending approval.
    """
    if cint(doc.docstatus) != 1:
        return False

    next_states = {transition.next_state for transition in transitions if transition.next_state}
    if not next_states:
        return False

    state_docstatus = _workflow_state_docstatuses(doc.doctype, state_docstatus_cache)
    return all(state_docstatus.get(state) == 2 for state in next_states)


def _ensure_follow_up_access():
    """Allow only trusted workflow monitoring users to read all workflow data."""
    if frappe.session.user == "Administrator":
        return
    if FOLLOW_UP_ROLES.intersection(frappe.get_roles(frappe.session.user)):
        return
    frappe.throw(_("You do not have permission to access Approval Follow-up."), frappe.PermissionError)


def _eligible_actions(filters=None):
    """Return open native Workflow Actions the current user can genuinely take.

    `frappe.get_list` applies Workflow Action's own permission query, which is
    role based. We additionally load the referenced document and check the
    transition condition and document permission. This prevents a UI tab from
    becoming an authorization mechanism.
    """
    filters = _parse_filters(filters)
    action_filters = {"status": "Open"}
    if filters.doctype:
        action_filters["reference_doctype"] = filters.doctype
    search_term = str(filters.search or "").strip()
    if search_term:
        action_filters["reference_name"] = ["like", f"%{search_term}%"]

    actions = frappe.get_list(
        "Workflow Action",
        filters=action_filters,
        fields=["name", "reference_doctype", "reference_name", "workflow_state", "creation"],
        order_by="creation asc",
        limit_page_length=500,
    )

    eligible = []
    state_docstatus_cache = {}
    for workflow_action in actions:
        try:
            # Workflow Action records can outlive a deleted or renamed document.
            # Check first so Frappe does not add one "not found" message per stale row
            # to the current request's response.
            if not _has_read_permission_silently(workflow_action.reference_doctype):
                continue
            if not frappe.db.exists(workflow_action.reference_doctype, workflow_action.reference_name):
                continue
            doc = frappe.get_doc(workflow_action.reference_doctype, workflow_action.reference_name)
            if not _has_read_permission_silently(doc):
                continue
            transitions = [
                transition
                for transition in get_transitions(doc, raise_exception=True)
                if has_approval_access(frappe.session.user, doc, transition)
            ]
            if not transitions:
                continue
            if _has_only_docstatus_two_transitions(doc, transitions, state_docstatus_cache):
                continue
            eligible.append(frappe._dict(workflow_action=workflow_action, doc=doc, transitions=transitions))
        except frappe.PermissionError:
            # An old Workflow Action may remain after a user's document access
            # changes. Never expose that document in the dashboard.
            continue
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Approval Center: skipped workflow action")
    return eligible


def _tab_key(doctype, state):
    return f"{doctype}::{state}"


def _matches_filters(doc, filters):
    """Apply optional cross-DocType filters only when the field exists."""
    search_term = str(filters.search or "").strip().lower()
    if search_term and search_term not in doc.name.lower():
        return False
    if filters.company and doc.meta.has_field("company") and doc.get("company") != filters.company:
        return False
    if filters.priority and doc.meta.has_field("priority") and doc.get("priority") != filters.priority:
        return False
    if filters.from_date and get_datetime(doc.creation).date() < get_datetime(filters.from_date).date():
        return False
    if filters.to_date and get_datetime(doc.creation).date() > get_datetime(filters.to_date).date():
        return False
    min_age_days = cint(filters.min_age_days)
    if min_age_days and (now_datetime().date() - get_datetime(doc.creation).date()).days < min_age_days:
        return False

    total = _document_total(doc)
    if filters.min_amount not in (None, "") and total < float(filters.min_amount):
        return False
    if filters.max_amount not in (None, "") and total > float(filters.max_amount):
        return False
    return True


def _document_total(doc):
    for fieldname in TOTAL_FIELDS:
        if doc.meta.has_field(fieldname) and doc.get(fieldname) is not None:
            return _numeric_value(doc.get(fieldname))
    return 0


def _numeric_value(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def _display_value(value):
    """Return a compact display-safe value, excluding empty/table values."""
    if value is None or isinstance(value, (list, tuple, dict)):
        return None
    value = str(value).strip()
    return value or None


def _field_value(doc, fieldname):
    if not doc.meta.has_field(fieldname):
        return None
    return _display_value(doc.get(fieldname))


def _semantic_field_value(doc):
    """Find a useful identity field for custom DocTypes with non-standard names."""
    for field in doc.meta.fields:
        if not field.fieldname or field.hidden or field.fieldtype not in CARD_FIELD_TYPES:
            continue
        identity = f"{field.fieldname} {field.label or ''}".lower()
        if any(keyword in identity for keyword in IDENTITY_KEYWORDS):
            value = _field_value(doc, field.fieldname)
            if value and value != doc.name:
                return value
    return None


def _document_title(doc):
    title_field = doc.meta.get_title_field()
    title = _field_value(doc, title_field) if title_field else None
    if title and title != doc.name:
        return title

    for fieldname in CARD_TITLE_FIELDS:
        value = _field_value(doc, fieldname)
        if value and value != doc.name:
            return value

    return _semantic_field_value(doc) or doc.name


def _stock_entry_warehouse(doc, parent_field, item_field):
    """Read a Stock Entry warehouse from its header, then its item rows."""
    warehouse = _field_value(doc, parent_field)
    if warehouse:
        return warehouse

    warehouses = []
    for item in doc.get("items") or []:
        warehouse = _display_value(item.get(item_field))
        if warehouse and warehouse not in warehouses:
            warehouses.append(warehouse)
    return ", ".join(warehouses)


def _stock_entry_total_quantity(doc):
    if doc.meta.has_field("total_qty") and doc.get("total_qty") not in (None, ""):
        return _numeric_value(doc.get("total_qty"))
    return sum(_numeric_value(item.get("qty")) for item in doc.get("items") or [])


def _stock_entry_total_value(doc):
    for fieldname in ("total_amount", "total_outgoing_value", "total_incoming_value", "total_basic_amount"):
        if doc.meta.has_field(fieldname) and doc.get(fieldname) not in (None, ""):
            amount = _numeric_value(doc.get(fieldname))
            if amount:
                return amount
    return sum(_numeric_value(item.get("basic_amount")) for item in doc.get("items") or [])


def _document_currency(doc):
    if doc.meta.has_field("currency") and doc.get("currency"):
        return doc.get("currency")
    if doc.meta.has_field("company") and doc.get("company"):
        return frappe.get_cached_value("Company", doc.company, "default_currency")
    return None


def _stock_entry_metrics(doc):
    """Return the compact quantity/value summary displayed beside the title."""
    metrics = []
    quantity = _stock_entry_total_quantity(doc)
    value = _stock_entry_total_value(doc)
    if quantity:
        metrics.append({"label": _("Total Quantity"), "value": quantity, "kind": "number"})
    if value:
        metrics.append(
            {
                "label": _("Total Product Value"),
                "value": value,
                "kind": "currency",
                "currency": _document_currency(doc),
            }
        )
    return metrics


def _card_details(doc):
    """Return relevant card facts without empty placeholders."""
    details = []
    seen_values = {doc.name, _document_title(doc)}
    max_details = 2

    def add_detail(label, value, kind="text", currency=None, allow_duplicate=False):
        if len(details) >= max_details:
            return
        if not value or (not allow_duplicate and value in seen_values):
            return
        detail = {"label": label, "value": value, "kind": kind}
        if currency:
            detail["currency"] = currency
        details.append(detail)
        seen_values.add(value)

    def add_field(fieldname, kind="text"):
        field = doc.meta.get_field(fieldname)
        if field:
            add_detail(field.label or fieldname.replace("_", " ").title(), _field_value(doc, fieldname), kind)

    if doc.doctype == "Stock Entry":
        add_detail(_("Source Warehouse"), _stock_entry_warehouse(doc, "from_warehouse", "s_warehouse"), allow_duplicate=True)
        add_detail(_("Target Warehouse"), _stock_entry_warehouse(doc, "to_warehouse", "t_warehouse"), allow_duplicate=True)
        if details:
            return details

    # These fields are meaningful for most business documents and retain the
    # familiar company/amount context where it actually exists.
    add_field("company")
    for fieldname in TOTAL_FIELDS:
        field = doc.meta.get_field(fieldname)
        raw_value = doc.get(fieldname) if field else None
        amount = _numeric_value(raw_value)
        if field and raw_value not in (None, "") and amount:
            details.append(
                {
                    "label": field.label or _("Amount"),
                    "value": amount,
                    "kind": "currency",
                    "currency": doc.get("currency") if doc.meta.has_field("currency") else None,
                }
            )
            break

    for fieldname in CARD_DETAIL_FIELDS:
        add_field(fieldname)

    # Custom approval DocTypes often use their own field names. Match common
    # business labels as a final, metadata-driven fallback.
    for field in doc.meta.fields:
        if len(details) >= 2:
            break
        if not field.fieldname or field.hidden or field.fieldtype not in CARD_FIELD_TYPES:
            continue
        identity = f"{field.fieldname} {field.label or ''}".lower()
        if any(keyword in identity for keyword in IDENTITY_KEYWORDS):
            add_field(field.fieldname)

    if len(details) < 2:
        owner = _display_value(doc.owner)
        if owner and owner not in seen_values:
            details.append({"label": _("Created by"), "value": owner, "kind": "text"})

    return details


def _card_dates(doc):
    """Return the created date and one relevant due/required date when present."""
    dates = [{"label": _("Created"), "value": doc.creation}]

    for fieldname in DUE_DATE_FIELDS:
        field = doc.meta.get_field(fieldname)
        value = doc.get(fieldname) if field else None
        if field and value not in (None, ""):
            dates.append({"label": field.label or _("Due Date"), "value": value})
            break

    return dates


@frappe.whitelist()
def get_filter_options():
    """Return safe, user-relevant choices for the Approval Center filters."""
    workflow_doctypes = sorted(
        {
            workflow.document_type
            for workflow in frappe.get_all(
                "Workflow",
                filters={"is_active": 1},
                fields=["document_type"],
            )
            if workflow.document_type and _has_read_permission_silently(workflow.document_type)
        }
    )
    companies = sorted(frappe.get_list("Company", pluck="name"))
    default_company = frappe.defaults.get_user_default("company")

    return {
        "doctypes": workflow_doctypes,
        "companies": companies,
        "default_company": default_company if default_company in companies else None,
    }


@frappe.whitelist()
def get_workflow_summary(filters=None):
    """Summarise approvals available to the current user, by DocType and state.

    This deliberately uses the same eligibility rules as ``get_dashboard`` so a
    number on a backlog card always agrees with the user's approval-queue tab.
    """
    filters = _parse_filters(filters)
    today = now_datetime().date()
    grouped = {}

    # _eligible_actions verifies both workflow-role access and document access.
    # It is also the source of the cards/tabs returned by get_dashboard.
    for item in _eligible_actions(filters):
        doc = item.doc
        if not _matches_filters(doc, filters):
            continue

        state = item.workflow_action.workflow_state
        key = (doc.doctype, state)
        counts = grouped.setdefault(
            key,
            {
                "doctype": doc.doctype,
                "state": state,
                "pending": 0,
                "overdue": 0,
            },
        )
        counts["pending"] += 1
        if (today - get_datetime(doc.creation).date()).days > 3:
            counts["overdue"] += 1

    rows = sorted(grouped.values(), key=lambda row: (row["doctype"], row["state"]))
    return {
        "rows": rows,
        "total_pending": sum(row["pending"] for row in rows),
        "total_overdue": sum(row["overdue"] for row in rows),
    }


def _serialize_item(item):
    doc = item.doc
    return {
        "doctype": doc.doctype,
        "name": doc.name,
        "title": _document_title(doc),
        "state": item.workflow_action.workflow_state,
        "tab_key": _tab_key(doc.doctype, item.workflow_action.workflow_state),
        "creation": doc.creation,
        "modified": doc.modified,
        "owner": doc.owner,
        "company": doc.get("company") if doc.meta.has_field("company") else None,
        "priority": doc.get("priority") if doc.meta.has_field("priority") else None,
        "amount": _document_total(doc),
        "currency": doc.get("currency") if doc.meta.has_field("currency") else None,
        "card_details": _card_details(doc),
        "card_metrics": _stock_entry_metrics(doc) if doc.doctype == "Stock Entry" else [],
        "card_dates": _card_dates(doc),
        "actions": [transition.action for transition in item.transitions],
    }


@frappe.whitelist()
def get_dashboard(
    filters=None,
    tab_key=None,
    page=1,
    page_size=DEFAULT_PAGE_SIZE,
    sort_by="creation",
    sort_order="asc",
):
    """Get state tabs and one filtered page of documents for the Desk UI."""
    filters = _parse_filters(filters)
    page = max(cint(page), 1)
    page_size = min(max(cint(page_size), 1), MAX_PAGE_SIZE)
    sort_by = sort_by if sort_by in {"creation", "modified"} else "creation"
    sort_order = sort_order if sort_order in {"asc", "desc"} else "asc"

    items = [item for item in _eligible_actions(filters) if _matches_filters(item.doc, filters)]
    serialized = [_serialize_item(item) for item in items]

    tab_counts = {}
    for row in serialized:
        tab_counts.setdefault(
            row["tab_key"],
            {"key": row["tab_key"], "doctype": row["doctype"], "state": row["state"], "count": 0},
        )["count"] += 1
    tabs = sorted(tab_counts.values(), key=lambda tab: (tab["doctype"], tab["state"]))

    if tab_key:
        serialized = [row for row in serialized if row["tab_key"] == tab_key]
    serialized.sort(key=lambda row: row.get(sort_by) or "", reverse=sort_order == "desc")
    start = (page - 1) * page_size
    end = start + page_size

    today = now_datetime().date()
    return {
        "tabs": tabs,
        "documents": serialized[start:end],
        "total": len(serialized),
        "summary": {
            "pending": len(items),
            "overdue": sum(1 for item in items if (today - get_datetime(item.doc.creation).date()).days > 3),
        },
    }


def _follow_up_steps(doc, transitions, state_docstatus_cache):
    """Return the next workflow transitions for the read-only follow-up view.

    A state can offer more than one possible next action.  The first
    non-cancellation transition is used to categorise the card, while the card
    itself shows every available next transition to the follow-up user.
    """
    state_docstatus = _workflow_state_docstatuses(doc.doctype, state_docstatus_cache)
    seen = set()
    steps = []
    for transition in transitions:
        key = (transition.action or "", transition.next_state or "", transition.allowed or "")
        if key in seen:
            continue
        seen.add(key)
        steps.append(
            {
                "action": transition.action,
                "next_state": transition.next_state,
                "role": transition.allowed,
                "is_cancellation": state_docstatus.get(transition.next_state) == 2,
            }
        )
    return sorted(
        steps,
        key=lambda step: (step["is_cancellation"], step["next_state"] or "", step["action"] or ""),
    )


def _follow_up_tab_key(doctype, state, step):
    return "::".join((doctype or "", state or "", step["next_state"] or "", step["role"] or ""))


def _follow_up_overdue_counts(rows):
    """Return cumulative ageing buckets for the workflow monitoring header."""
    today = now_datetime().date()
    buckets = {"overdue_3": 0, "overdue_7": 0, "overdue_14": 0, "overdue_30": 0}
    for row in rows:
        age_days = (today - get_datetime(row["creation"]).date()).days
        if age_days >= 3:
            buckets["overdue_3"] += 1
        if age_days >= 7:
            buckets["overdue_7"] += 1
        if age_days >= 14:
            buckets["overdue_14"] += 1
        if age_days >= 30:
            buckets["overdue_30"] += 1
    return buckets


def _follow_up_items(filters=None):
    """Return all open workflow documents for trusted monitoring users.

    Unlike the Approval Center queue, this intentionally does *not* filter by
    the logged-in user's workflow role or document permissions.  The endpoint
    is protected by ``_ensure_follow_up_access`` and exists for assigned
    follow-up staff to monitor the organisation-wide workflow backlog.
    """
    _ensure_follow_up_access()
    filters = _parse_filters(filters)
    action_filters = {"status": "Open"}
    if filters.doctype:
        action_filters["reference_doctype"] = filters.doctype
    search_term = str(filters.search or "").strip()
    if search_term:
        action_filters["reference_name"] = ["like", f"%{search_term}%"]

    actions = frappe.get_all(
        "Workflow Action",
        filters=action_filters,
        fields=["name", "reference_doctype", "reference_name", "workflow_state", "creation"],
        order_by="creation asc",
    )

    items = []
    seen_documents = set()
    state_docstatus_cache = {}
    for workflow_action in actions:
        key = (workflow_action.reference_doctype, workflow_action.reference_name)
        if key in seen_documents:
            continue
        try:
            if not frappe.db.exists(*key):
                continue
            doc = frappe.get_doc(*key)
            transitions = get_transitions(doc, raise_exception=True)
            if not transitions or _has_only_docstatus_two_transitions(doc, transitions, state_docstatus_cache):
                continue
            if not _matches_filters(doc, filters):
                continue
            steps = _follow_up_steps(doc, transitions, state_docstatus_cache)
            if not steps:
                continue
            seen_documents.add(key)
            items.append(frappe._dict(workflow_action=workflow_action, doc=doc, transitions=transitions, steps=steps))
        except Exception:
            # Workflow Action rows can remain after a document/workflow changes.
            # A monitor should see the valid backlog rather than a page failure.
            frappe.log_error(frappe.get_traceback(), "Approval Follow-up: skipped workflow action")
    return items


@frappe.whitelist()
def get_follow_up_filter_options():
    """Return active workflow DocTypes and companies for the monitoring page."""
    _ensure_follow_up_access()
    doctypes = sorted(
        {
            workflow.document_type
            for workflow in frappe.get_all(
                "Workflow",
                filters={"is_active": 1},
                fields=["document_type"],
            )
            if workflow.document_type
        }
    )
    return {"doctypes": doctypes, "companies": sorted(frappe.get_all("Company", pluck="name"))}


@frappe.whitelist()
def get_follow_up_dashboard(filters=None, tab_key=None, sort_by="creation", sort_order="asc"):
    """Return read-only workflow monitoring data grouped by next transition."""
    _ensure_follow_up_access()
    sort_by = sort_by if sort_by in {"creation", "modified"} else "creation"
    sort_order = sort_order if sort_order in {"asc", "desc"} else "asc"
    items = _follow_up_items(filters)
    rows = []

    for item in items:
        row = _serialize_item(item)
        primary_step = item.steps[0]
        row.update(
            {
                "next_steps": item.steps,
                "tab_key": _follow_up_tab_key(row["doctype"], row["state"], primary_step),
                "next_action": primary_step["action"],
                "next_state": primary_step["next_state"],
                "next_role": primary_step["role"],
            }
        )
        rows.append(row)

    tab_counts = {}
    for row in rows:
        tab_counts.setdefault(
            row["tab_key"],
            {
                "key": row["tab_key"],
                "doctype": row["doctype"],
                "state": row["state"],
                "next_action": row["next_action"],
                "next_state": row["next_state"],
                "role": row["next_role"],
                "count": 0,
            },
        )["count"] += 1
    tabs = sorted(
        tab_counts.values(),
        key=lambda tab: (tab["doctype"], tab["state"], tab["next_state"], tab["role"] or ""),
    )

    filtered_rows = [row for row in rows if not tab_key or row["tab_key"] == tab_key]
    filtered_rows.sort(key=lambda row: row.get(sort_by) or "", reverse=sort_order == "desc")
    overdue_counts = _follow_up_overdue_counts(rows)
    return {
        "tabs": tabs,
        "documents": filtered_rows,
        "total": len(filtered_rows),
        "summary": {
            "pending": len(rows),
            "overdue": overdue_counts["overdue_3"],
            **overdue_counts,
        },
    }


@frappe.whitelist()
def get_document_details(doctype, name):
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    transitions = [
        transition
        for transition in get_transitions(doc, raise_exception=True)
        if has_approval_access(frappe.session.user, doc, transition)
    ]
    if not transitions:
        frappe.throw(_("You cannot take a workflow action on this document."), frappe.PermissionError)

    preferred_fields = ("company", "supplier", "customer", "employee", "department", "posting_date", "transaction_date", "grand_total", "total", "remarks")
    fields = []
    for fieldname in preferred_fields:
        field = doc.meta.get_field(fieldname)
        if field and doc.get(fieldname) not in (None, ""):
            fields.append({"label": field.label, "value": doc.get(fieldname), "fieldtype": field.fieldtype})
    return {"title": _document_title(doc), "fields": fields, "actions": [t.action for t in transitions]}


@frappe.whitelist()
def perform_workflow_action(doctype, name, action, comment=None):
    """Apply one native workflow action after validating it again server-side."""
    comment = (comment or "").strip()
    if action.strip().lower() in REJECTION_ACTIONS and not comment:
        frappe.throw(_("A reason is required when rejecting or sending back a document."))

    doc = frappe.get_doc(doctype, name)
    doc.check_permission("read")
    allowed = [
        transition
        for transition in get_transitions(doc, raise_exception=True)
        if transition.action == action and has_approval_access(frappe.session.user, doc, transition)
    ]
    if not allowed:
        frappe.throw(_("This workflow action is no longer available."), frappe.PermissionError)

    new_doc = apply_workflow(doc, action)
    if comment:
        new_doc.add_comment("Comment", text=comment)
    return {"name": new_doc.name, "state": new_doc.get("workflow_state"), "message": _("Workflow action applied.")}
