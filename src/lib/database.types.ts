
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agency_settings": {
                  Row: {
                    "absence_reminder_days": number,"agency_name": string,"allow_half_days": boolean,"allow_negative_vacation": boolean,"anniversary_reminder_days": (number)[],"carryover_cap_days": number | null,"coverage_warning_threshold": number,"default_allocation": Database["public"]['Enums']["allocation_method"],"default_vacation_year": Database["public"]['Enums']["vacation_year_type"],"email_notifications_enabled": boolean,"id": number,"lieu_expiry_months": number | null,"onboarding_completed": boolean,"standard_day_hours": number,"timezone": string,"updated_at": string,"updated_by": string | null,"working_days": (number)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "absence_reminder_days"?: number,"agency_name"?: string,"allow_half_days"?: boolean,"allow_negative_vacation"?: boolean,"anniversary_reminder_days"?: (number)[],"carryover_cap_days"?: number | null,"coverage_warning_threshold"?: number,"default_allocation"?: Database["public"]['Enums']["allocation_method"],"default_vacation_year"?: Database["public"]['Enums']["vacation_year_type"],"email_notifications_enabled"?: boolean,"id"?: number,"lieu_expiry_months"?: number | null,"onboarding_completed"?: boolean,"standard_day_hours"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"working_days"?: (number)[]
                  }
                  Update: {
                    "absence_reminder_days"?: number,"agency_name"?: string,"allow_half_days"?: boolean,"allow_negative_vacation"?: boolean,"anniversary_reminder_days"?: (number)[],"carryover_cap_days"?: number | null,"coverage_warning_threshold"?: number,"default_allocation"?: Database["public"]['Enums']["allocation_method"],"default_vacation_year"?: Database["public"]['Enums']["vacation_year_type"],"email_notifications_enabled"?: boolean,"id"?: number,"lieu_expiry_months"?: number | null,"onboarding_completed"?: boolean,"standard_day_hours"?: number,"timezone"?: string,"updated_at"?: string,"updated_by"?: string | null,"working_days"?: (number)[]
                  }
                  Relationships: [
                    
                  ]
                },"approval_records": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"id": string,"note": string | null,"subject_employee_id": string | null,"subject_id": string,"subject_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"note"?: string | null,"subject_employee_id"?: string | null,"subject_id": string,"subject_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"id"?: string,"note"?: string | null,"subject_employee_id"?: string | null,"subject_id"?: string,"subject_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_records_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_records_subject_employee_id_fkey"
      columns: ["subject_employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_user_id": string | null,"created_at": string,"id": number,"new_data": Json | null,"old_data": Json | null,"record_id": string | null,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_user_id"?: string | null,"created_at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_user_id"?: string | null,"created_at"?: string,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"employee_profiles": {
                  Row: {
                    "backup_approver_id": string | null,"created_at": string,"deactivated_at": string | null,"department": string | null,"full_name": string,"id": string,"invited_at": string | null,"job_title": string | null,"manager_id": string | null,"role": Database["public"]['Enums']["app_role"],"self_approval_allowed": boolean,"standard_day_hours": number | null,"start_date": string,"status": Database["public"]['Enums']["employment_status"],"updated_at": string,"user_id": string | null,"work_email": string
                  }
                  ComputedFields: never
                  Insert: {
                    "backup_approver_id"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"department"?: string | null,"full_name": string,"id"?: string,"invited_at"?: string | null,"job_title"?: string | null,"manager_id"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"self_approval_allowed"?: boolean,"standard_day_hours"?: number | null,"start_date": string,"status"?: Database["public"]['Enums']["employment_status"],"updated_at"?: string,"user_id"?: string | null,"work_email": string
                  }
                  Update: {
                    "backup_approver_id"?: string | null,"created_at"?: string,"deactivated_at"?: string | null,"department"?: string | null,"full_name"?: string,"id"?: string,"invited_at"?: string | null,"job_title"?: string | null,"manager_id"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"self_approval_allowed"?: boolean,"standard_day_hours"?: number | null,"start_date"?: string,"status"?: Database["public"]['Enums']["employment_status"],"updated_at"?: string,"user_id"?: string | null,"work_email"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "employee_profiles_backup_approver_id_fkey"
      columns: ["backup_approver_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employee_profiles_manager_id_fkey"
      columns: ["manager_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"employment_records": {
                  Row: {
                    "created_at": string,"created_by": string | null,"department": string | null,"effective_from": string,"employee_id": string,"id": string,"job_title": string | null,"manager_id": string | null,"note": string | null,"role": Database["public"]['Enums']["app_role"],"status": Database["public"]['Enums']["employment_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"department"?: string | null,"effective_from": string,"employee_id": string,"id"?: string,"job_title"?: string | null,"manager_id"?: string | null,"note"?: string | null,"role": Database["public"]['Enums']["app_role"],"status": Database["public"]['Enums']["employment_status"]
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"department"?: string | null,"effective_from"?: string,"employee_id"?: string,"id"?: string,"job_title"?: string | null,"manager_id"?: string | null,"note"?: string | null,"role"?: Database["public"]['Enums']["app_role"],"status"?: Database["public"]['Enums']["employment_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "employment_records_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "employment_records_manager_id_fkey"
      columns: ["manager_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"lieu_rule_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"effective_from": string,"id": string,"require_approval": boolean,"weekday_credit": number,"weekday_min_hours": number,"weekday_review_above_hours": number,"weekend_full_credit": number,"weekend_full_min_hours": number,"weekend_half_credit": number,"weekend_half_min_hours": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"effective_from": string,"id"?: string,"require_approval"?: boolean,"weekday_credit"?: number,"weekday_min_hours"?: number,"weekday_review_above_hours"?: number,"weekend_full_credit"?: number,"weekend_full_min_hours"?: number,"weekend_half_credit"?: number,"weekend_half_min_hours"?: number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"id"?: string,"require_approval"?: boolean,"weekday_credit"?: number,"weekday_min_hours"?: number,"weekday_review_above_hours"?: number,"weekend_full_credit"?: number,"weekend_full_min_hours"?: number,"weekend_half_credit"?: number,"weekend_half_min_hours"?: number
                  }
                  Relationships: [
                    
                  ]
                },"lieu_submissions": {
                  Row: {
                    "adjustment_reason": string | null,"approver_id": string | null,"created_at": string,"employee_id": string,"id": string,"needs_review": boolean,"note": string | null,"project_id": string,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"source": string,"status": Database["public"]['Enums']["lieu_submission_status"],"submitted_by": string | null,"total_approved": number | null,"total_proposed": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "adjustment_reason"?: string | null,"approver_id"?: string | null,"created_at"?: string,"employee_id": string,"id"?: string,"needs_review"?: boolean,"note"?: string | null,"project_id": string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: string,"status"?: Database["public"]['Enums']["lieu_submission_status"],"submitted_by"?: string | null,"total_approved"?: number | null,"total_proposed"?: number,"updated_at"?: string
                  }
                  Update: {
                    "adjustment_reason"?: string | null,"approver_id"?: string | null,"created_at"?: string,"employee_id"?: string,"id"?: string,"needs_review"?: boolean,"note"?: string | null,"project_id"?: string,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: string,"status"?: Database["public"]['Enums']["lieu_submission_status"],"submitted_by"?: string | null,"total_approved"?: number | null,"total_proposed"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lieu_submissions_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_submissions_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_submissions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_submissions_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_submissions_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"lieu_transactions": {
                  Row: {
                    "amount": number,"category": Database["public"]['Enums']["lieu_category"],"created_at": string,"created_by": string | null,"effective_date": string,"employee_id": string,"id": string,"project_id": string | null,"reason": string | null,"request_id": string | null,"submission_id": string | null,"txn_type": Database["public"]['Enums']["lieu_txn_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"category"?: Database["public"]['Enums']["lieu_category"],"created_at"?: string,"created_by"?: string | null,"effective_date": string,"employee_id": string,"id"?: string,"project_id"?: string | null,"reason"?: string | null,"request_id"?: string | null,"submission_id"?: string | null,"txn_type": Database["public"]['Enums']["lieu_txn_type"]
                  }
                  Update: {
                    "amount"?: number,"category"?: Database["public"]['Enums']["lieu_category"],"created_at"?: string,"created_by"?: string | null,"effective_date"?: string,"employee_id"?: string,"id"?: string,"project_id"?: string | null,"reason"?: string | null,"request_id"?: string | null,"submission_id"?: string | null,"txn_type"?: Database["public"]['Enums']["lieu_txn_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "lieu_transactions_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_transactions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_transactions_request_fk"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "time_off_requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_transactions_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "lieu_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"lieu_work_entries": {
                  Row: {
                    "approved_credit": number | null,"category": Database["public"]['Enums']["lieu_category"],"day_type": Database["public"]['Enums']["lieu_day_type"],"employee_id": string,"hours": number,"id": string,"is_active": boolean,"needs_review": boolean,"project_id": string,"proposed_credit": number,"review_reason": string | null,"rule_version_id": string,"submission_id": string,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_credit"?: number | null,"category"?: Database["public"]['Enums']["lieu_category"],"day_type": Database["public"]['Enums']["lieu_day_type"],"employee_id": string,"hours": number,"id"?: string,"is_active"?: boolean,"needs_review"?: boolean,"project_id": string,"proposed_credit": number,"review_reason"?: string | null,"rule_version_id": string,"submission_id": string,"work_date": string
                  }
                  Update: {
                    "approved_credit"?: number | null,"category"?: Database["public"]['Enums']["lieu_category"],"day_type"?: Database["public"]['Enums']["lieu_day_type"],"employee_id"?: string,"hours"?: number,"id"?: string,"is_active"?: boolean,"needs_review"?: boolean,"project_id"?: string,"proposed_credit"?: number,"review_reason"?: string | null,"rule_version_id"?: string,"submission_id"?: string,"work_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lieu_work_entries_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_work_entries_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_work_entries_rule_version_id_fkey"
      columns: ["rule_version_id"]
isOneToOne: false
      referencedRelation: "lieu_rule_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lieu_work_entries_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "lieu_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "body": string | null,"created_at": string,"dedupe_key": string | null,"emailed_at": string | null,"id": string,"link": string | null,"read_at": string | null,"recipient_id": string,"title": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"emailed_at"?: string | null,"id"?: string,"link"?: string | null,"read_at"?: string | null,"recipient_id": string,"title": string,"type": string
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"emailed_at"?: string | null,"id"?: string,"link"?: string | null,"read_at"?: string | null,"recipient_id"?: string,"title"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "client": string | null,"created_at": string,"created_by": string | null,"id": string,"is_active": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name": string
                  }
                  Update: {
                    "client"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"public_holidays": {
                  Row: {
                    "created_at": string,"created_by": string | null,"holiday_date": string,"id": string,"kind": Database["public"]['Enums']["holiday_kind"],"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"holiday_date": string,"id"?: string,"kind"?: Database["public"]['Enums']["holiday_kind"],"name": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"holiday_date"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["holiday_kind"],"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"time_off_request_days": {
                  Row: {
                    "amount": number,"employee_id": string,"is_active": boolean,"leave_date": string,"portion": Database["public"]['Enums']["day_portion"],"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"employee_id": string,"is_active"?: boolean,"leave_date": string,"portion": Database["public"]['Enums']["day_portion"],"request_id": string
                  }
                  Update: {
                    "amount"?: number,"employee_id"?: string,"is_active"?: boolean,"leave_date"?: string,"portion"?: Database["public"]['Enums']["day_portion"],"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_off_request_days_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_request_days_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "time_off_requests"
      referencedColumns: ["id"]
    }
                  ]
                },"time_off_requests": {
                  Row: {
                    "approver_id": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"created_at": string,"created_by": string | null,"days": number,"employee_id": string,"end_date": string,"id": string,"is_advance": boolean,"kind": Database["public"]['Enums']["time_off_kind"],"lieu_category": Database["public"]['Enums']["lieu_category"] | null,"note": string | null,"portion": Database["public"]['Enums']["day_portion"],"project_id": string | null,"review_note": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"start_date": string,"status": Database["public"]['Enums']["request_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approver_id"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"days": number,"employee_id": string,"end_date": string,"id"?: string,"is_advance"?: boolean,"kind": Database["public"]['Enums']["time_off_kind"],"lieu_category"?: Database["public"]['Enums']["lieu_category"] | null,"note"?: string | null,"portion"?: Database["public"]['Enums']["day_portion"],"project_id"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"start_date": string,"status"?: Database["public"]['Enums']["request_status"],"updated_at"?: string
                  }
                  Update: {
                    "approver_id"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"days"?: number,"employee_id"?: string,"end_date"?: string,"id"?: string,"is_advance"?: boolean,"kind"?: Database["public"]['Enums']["time_off_kind"],"lieu_category"?: Database["public"]['Enums']["lieu_category"] | null,"note"?: string | null,"portion"?: Database["public"]['Enums']["day_portion"],"project_id"?: string | null,"review_note"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"start_date"?: string,"status"?: Database["public"]['Enums']["request_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "time_off_requests_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_requests_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_requests_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_requests_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_off_requests_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"vacation_entitlements": {
                  Row: {
                    "allocation_method": Database["public"]['Enums']["allocation_method"],"annual_days": number,"created_at": string,"created_by": string | null,"effective_from": string,"employee_id": string,"id": string,"note": string | null,"year_type": Database["public"]['Enums']["vacation_year_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "allocation_method": Database["public"]['Enums']["allocation_method"],"annual_days": number,"created_at"?: string,"created_by"?: string | null,"effective_from": string,"employee_id": string,"id"?: string,"note"?: string | null,"year_type": Database["public"]['Enums']["vacation_year_type"]
                  }
                  Update: {
                    "allocation_method"?: Database["public"]['Enums']["allocation_method"],"annual_days"?: number,"created_at"?: string,"created_by"?: string | null,"effective_from"?: string,"employee_id"?: string,"id"?: string,"note"?: string | null,"year_type"?: Database["public"]['Enums']["vacation_year_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "vacation_entitlements_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"vacation_tracking": {
                  Row: {
                    "employee_id": string,"is_new_hire": boolean,"tracking_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "employee_id": string,"is_new_hire"?: boolean,"tracking_start": string
                  }
                  Update: {
                    "employee_id"?: string,"is_new_hire"?: boolean,"tracking_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "vacation_tracking_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: true
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"vacation_transactions": {
                  Row: {
                    "accrual_key": string | null,"amount": number,"created_at": string,"created_by": string | null,"effective_date": string,"employee_id": string,"id": string,"period_start": string | null,"reason": string | null,"request_id": string | null,"txn_type": Database["public"]['Enums']["vacation_txn_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "accrual_key"?: string | null,"amount": number,"created_at"?: string,"created_by"?: string | null,"effective_date": string,"employee_id": string,"id"?: string,"period_start"?: string | null,"reason"?: string | null,"request_id"?: string | null,"txn_type": Database["public"]['Enums']["vacation_txn_type"]
                  }
                  Update: {
                    "accrual_key"?: string | null,"amount"?: number,"created_at"?: string,"created_by"?: string | null,"effective_date"?: string,"employee_id"?: string,"id"?: string,"period_start"?: string | null,"reason"?: string | null,"request_id"?: string | null,"txn_type"?: Database["public"]['Enums']["vacation_txn_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "vacation_transactions_employee_id_fkey"
      columns: ["employee_id"]
isOneToOne: false
      referencedRelation: "employee_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vacation_transactions_request_fk"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "time_off_requests"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_add_holiday":
{ Args: { "holiday_date": string,"kind"?: Database["public"]['Enums']["holiday_kind"],"name": string }; Returns: string
                           },
"admin_adjust_balance":
{ Args: { "amount": number,"category"?: Database["public"]['Enums']["lieu_category"],"effective_date"?: string,"emp": string,"ledger": string,"reason": string }; Returns: string
                           },
"admin_delete_holiday":
{ Args: { "holiday_id": string }; Returns: undefined
                           },
"admin_employee_table":
{ Args: Record<PropertyKey, never>; Returns: {
              "annual_days": number,"department": string,"full_name": string,"has_login": boolean,"id": string,"invited_at": string,"job_title": string,"lieu_available": number,"manager_name": string,"next_leave_end": string,"next_leave_start": string,"role": Database["public"]['Enums']["app_role"],"start_date": string,"status": Database["public"]['Enums']["employment_status"],"vacation_available": number,"work_email": string
            }[]
                           },
"admin_generate_holidays":
{ Args: { "yr": number }; Returns: number
                           },
"admin_mark_invited":
{ Args: { "emp": string }; Returns: undefined
                           },
"admin_run_maintenance":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"admin_save_employee":
{ Args: { "payload": Json }; Returns: string
                           },
"admin_save_lieu_rules":
{ Args: { "effective_from"?: string,"payload": Json }; Returns: string
                           },
"admin_save_settings":
{ Args: { "payload": Json }; Returns: undefined
                           },
"admin_set_employee_status":
{ Args: { "emp": string,"new_status": Database["public"]['Enums']["employment_status"] }; Returns: undefined
                           },
"admin_set_entitlement":
{ Args: { "allocation_method": Database["public"]['Enums']["allocation_method"],"annual_days": number,"effective_from": string,"emp": string,"note": string,"year_type": Database["public"]['Enums']["vacation_year_type"] }; Returns: string
                           },
"admin_set_self_approval":
{ Args: { "allowed": boolean,"emp": string }; Returns: undefined
                           },
"admin_update_project":
{ Args: { "client": string,"is_active": boolean,"name": string,"project_id": string }; Returns: undefined
                           },
"anniversary_in_year":
{ Args: { "start_date": string,"yr": number }; Returns: string
                           },
"approval_queue_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "pending_lieu_submissions": number,"pending_lieu_usage": number,"pending_vacation": number
            }[]
                           },
"bulk_lieu":
{ Args: { "note"?: string,"project_id": string,"rows": Json }; Returns: {
              "employee_id": string,"status": Database["public"]['Enums']["lieu_submission_status"],"submission_id": string,"total": number
            }[]
                           },
"calc_lieu_credit":
{ Args: { "hours": number,"work_date": string }; Returns: {
              "category": Database["public"]['Enums']["lieu_category"],"day_type": Database["public"]['Enums']["lieu_day_type"],"needs_review": boolean,"proposed_credit": number,"review_reason": string,"rule_version_id": string
            }[]
                           },
"cancel_lieu_submission":
{ Args: { "submission_id": string }; Returns: undefined
                           },
"cancel_time_off":
{ Args: { "reason"?: string,"request_id": string }; Returns: undefined
                           },
"create_project":
{ Args: { "client"?: string,"name": string }; Returns: string
                           },
"cron_daily_maintenance":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"is_holiday":
{ Args: { "d": string }; Returns: boolean
                           },
"is_working_day":
{ Args: { "d": string }; Returns: boolean
                           },
"leadership_overview":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"leave_days":
{ Args: { "end_date": string,"portion"?: Database["public"]['Enums']["day_portion"],"start_date": string }; Returns: {
              "amount": number,"leave_date": string
            }[]
                           },
"lieu_balance":
{ Args: { "emp": string }; Returns: {
              "adjustments": number,"available": number,"booked": number,"category": Database["public"]['Enums']["lieu_category"],"earned": number,"pending_credits": number,"pending_usage": number,"used": number
            }[]
                           },
"lieu_review_context":
{ Args: { "submission_id": string }; Returns: {
              "advance_days": Json,"lieu_available": number
            }[]
                           },
"mark_notifications_emailed":
{ Args: { "ids": (string)[] }; Returns: undefined
                           },
"mark_notifications_read":
{ Args: { "ids"?: (string)[] }; Returns: undefined
                           },
"my_approvers":
{ Args: Record<PropertyKey, never>; Returns: {
              "full_name": string,"id": string
            }[]
                           },
"my_profile_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"next_anniversary":
{ Args: { "as_of": string,"start_date": string }; Returns: string
                           },
"ontario_stat_holidays":
{ Args: { "yr": number }; Returns: {
              "holiday_date": string,"name": string
            }[]
                           },
"pending_email_notifications":
{ Args: { "max_rows"?: number }; Returns: {
              "body": string,"email": string,"full_name": string,"id": string,"link": string,"title": string
            }[]
                           },
"people_directory":
{ Args: Record<PropertyKey, never>; Returns: {
              "full_name": string,"id": string,"job_title": string,"role": Database["public"]['Enums']["app_role"]
            }[]
                           },
"preview_bulk_lieu":
{ Args: { "project_id": string,"rows": Json }; Returns: {
              "conflict": boolean,"day_type": Database["public"]['Enums']["lieu_day_type"],"employee_id": string,"full_name": string,"hours": number,"needs_review": boolean,"proposed_credit": number,"review_reason": string,"work_date": string
            }[]
                           },
"preview_time_off":
{ Args: { "end_date": string,"portion"?: Database["public"]['Enums']["day_portion"],"start_date": string }; Returns: {
              "days": number,"holidays": (string)[],"overlaps": boolean,"working_dates": (string)[]
            }[]
                           },
"recent_activity":
{ Args: { "emp": string,"max_rows"?: number }; Returns: {
              "amount": number,"description": string,"ledger": string,"occurred_at": string
            }[]
                           },
"report_lieu":
{ Args: { "from_date"?: string,"to_date"?: string }; Returns: {
              "approved_credit": number,"category": Database["public"]['Enums']["lieu_category"],"day_type": Database["public"]['Enums']["lieu_day_type"],"employee_id": string,"full_name": string,"hours": number,"lieu_used": number,"project": string,"proposed_credit": number,"remaining_balance": number,"status": Database["public"]['Enums']["lieu_submission_status"],"work_date": string
            }[]
                           },
"report_project":
{ Args: { "project_id": string }; Returns: {
              "approved_credit": number,"day_type": Database["public"]['Enums']["lieu_day_type"],"employee_id": string,"full_name": string,"hours": number,"proposed_credit": number,"status": Database["public"]['Enums']["lieu_submission_status"],"work_date": string
            }[]
                           },
"report_vacation":
{ Args: Record<PropertyKey, never>; Returns: {
              "adjustments": number,"annual_entitlement": number,"available": number,"booked": number,"carryover": number,"earned": number,"employee_id": string,"full_name": string,"opening_balance": number,"pending": number,"period_end": string,"period_start": string,"status": Database["public"]['Enums']["employment_status"],"used": number
            }[]
                           },
"request_review_context":
{ Args: { "request_id": string }; Returns: {
              "coverage": Json,"lieu_available": number,"lieu_pending": number,"vacation_available": number,"vacation_pending": number
            }[]
                           },
"review_lieu":
{ Args: { "adjustment_reason"?: string,"adjustments"?: Json,"decision": string,"note"?: string,"submission_id": string }; Returns: undefined
                           },
"review_time_off":
{ Args: { "decision": string,"note"?: string,"request_id": string }; Returns: undefined
                           },
"statutory_minimum_days":
{ Args: { "as_of": string,"start_date": string }; Returns: number
                           },
"submit_lieu":
{ Args: { "entries": Json,"note"?: string,"project_id": string,"resubmit_id"?: string }; Returns: string
                           },
"submit_time_off":
{ Args: { "end_date": string,"for_employee"?: string,"is_advance"?: boolean,"kind": Database["public"]['Enums']["time_off_kind"],"lieu_category"?: Database["public"]['Enums']["lieu_category"],"note"?: string,"portion"?: Database["public"]['Enums']["day_portion"],"project_id"?: string,"start_date": string }; Returns: string
                           },
"sync_my_vacation":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"team_calendar":
{ Args: { "from_date": string,"to_date": string }; Returns: {
              "can_see_details": boolean,"employee_id": string,"full_name": string,"is_self": boolean,"kind": string,"leave_date": string,"portion": Database["public"]['Enums']["day_portion"],"status": Database["public"]['Enums']["request_status"]
            }[]
                           },
"upcoming_anniversaries":
{ Args: { "within_days"?: number }; Returns: {
              "anniversary": string,"days_until": number,"employee_id": string,"full_name": string,"job_title": string,"start_date": string,"years": number
            }[]
                           },
"vacation_balance":
{ Args: { "emp": string }; Returns: {
              "adjustments": number,"allocation_method": Database["public"]['Enums']["allocation_method"],"annual_entitlement": number,"available": number,"available_after_pending": number,"booked": number,"carried_forward": number,"earned": number,"opening": number,"pending": number,"period_end": string,"period_start": string,"used": number,"year_type": Database["public"]['Enums']["vacation_year_type"]
            }[]
                           },
"vacation_period":
{ Args: { "d": string,"emp": string }; Returns: Record<string, unknown>
                           },
"years_of_service":
{ Args: { "as_of": string,"start_date": string }; Returns: number
                           }
          }
          Enums: {
            "allocation_method": "upfront"|"accrual","app_role": "employee"|"manager"|"people_admin","day_portion": "full"|"am"|"pm","employment_status": "active"|"inactive","holiday_kind": "statutory"|"closure","lieu_category": "discretionary"|"statutory","lieu_day_type": "weekend"|"weekday"|"holiday","lieu_submission_status": "pending"|"approved"|"declined"|"changes_requested"|"cancelled","lieu_txn_type": "opening_balance"|"credit"|"usage"|"usage_reversal"|"adjustment"|"expiry","request_status": "pending"|"approved"|"declined"|"cancelled","time_off_kind": "vacation"|"lieu","vacation_txn_type": "opening_balance"|"opening_carryover"|"allocation"|"accrual"|"usage"|"usage_reversal"|"adjustment"|"carryover_forfeit","vacation_year_type": "calendar"|"anniversary"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "allocation_method": ["upfront", "accrual"],"app_role": ["employee", "manager", "people_admin"],"day_portion": ["full", "am", "pm"],"employment_status": ["active", "inactive"],"holiday_kind": ["statutory", "closure"],"lieu_category": ["discretionary", "statutory"],"lieu_day_type": ["weekend", "weekday", "holiday"],"lieu_submission_status": ["pending", "approved", "declined", "changes_requested", "cancelled"],"lieu_txn_type": ["opening_balance", "credit", "usage", "usage_reversal", "adjustment", "expiry"],"request_status": ["pending", "approved", "declined", "cancelled"],"time_off_kind": ["vacation", "lieu"],"vacation_txn_type": ["opening_balance", "opening_carryover", "allocation", "accrual", "usage", "usage_reversal", "adjustment", "carryover_forfeit"],"vacation_year_type": ["calendar", "anniversary"]
          }
        }
} as const
