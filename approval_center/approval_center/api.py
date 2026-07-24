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

    actions = frappe.get_list(
        "Workflow Action",
        filters=action_filters,
        fields=["name", "reference_doctype", "reference_name", "workflow_state", "creation"],
        order_by="creation asc",
        limit_page_length=500,
    )

    eligible = []
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
    if filters.company and doc.meta.has_field("company") and doc.get("company") != filters.company:
        return False
    if filters.priority and doc.meta.has_field("priority") and doc.get("priority") != filters.priority:
        return False
    if filters.from_date and get_datetime(doc.creation).date() < get_datetime(filters.from_date).date():
        return False
    if filters.to_date and get_datetime(doc.creation).date() > get_datetime(filters.to_date).date():
        return False

    total = _document_total(doc)
    if filters.min_amount not in (None, "") and total < float(filters.min_amount):
        return False
    if filters.max_amount not in (None, "") and total > float(filters.max_amount):
        return False
    return True


def _document_total(doc):
    for fieldname in ("grand_total", "rounded_total", "total", "net_total"):
        if doc.meta.has_field(fieldname) and doc.get(fieldname) is not None:
            return float(doc.get(fieldname) or 0)
    return 0


def _document_title(doc):
    title_field = doc.meta.get_title_field()
    return doc.get(title_field) if title_field else doc.name


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
