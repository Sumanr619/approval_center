"""Desk boot customisations for Approval Center."""

import frappe


def set_approval_center_home(bootinfo):
    """Mark users with an active workflow approval role for Approval Center.

    The browser uses this flag only when the user enters the bare Desk route
    (``/app``). It does not prevent them from navigating to another workspace.
    """
    user = frappe.session.user
    if not user or user == "Guest":
        bootinfo["approval_center_home"] = False
        return

    user_roles = set(frappe.get_roles(user))
    active_workflows = frappe.get_all("Workflow", filters={"is_active": 1}, pluck="name")
    if not user_roles or not active_workflows:
        bootinfo["approval_center_home"] = False
        return

    approval_roles = {
        transition.allowed
        for transition in frappe.get_all(
            "Workflow Transition",
            filters={"parent": ["in", active_workflows]},
            fields=["allowed"],
        )
        if transition.allowed
    }
    bootinfo["approval_center_home"] = bool(user_roles.intersection(approval_roles))
