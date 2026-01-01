/**
 * Supabase Database Types
 *
 * This file should be auto-generated from your Supabase schema.
 * Run: `supabase gen types typescript --local > lib/supabase/database.types.ts`
 *
 * This is a manually maintained version that matches the schema.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// =============================================================================
// Enum Types
// =============================================================================

export type UserRole = "owner" | "admin" | "member" | "viewer";
export type MembershipStatus = "pending" | "active" | "suspended" | "removed";
export type TaskStatus = "pending" | "in_progress" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type IntegrationProvider =
  | "google_workspace"
  | "microsoft_365"
  | "slack"
  | "quickbooks"
  | "stripe"
  | "hubspot"
  | "custom_webhook";
export type IntegrationStatus = "pending_auth" | "active" | "expired" | "revoked" | "error";

// =============================================================================
// Database Interface
// =============================================================================

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      profiles: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          full_name: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          organization_id: string;
          email: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string;
          full_name?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };

      org_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string | null;
          email: string;
          role: UserRole;
          status: MembershipStatus;
          invited_by: string | null;
          invited_at: string;
          joined_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id?: string | null;
          email: string;
          role?: UserRole;
          status?: MembershipStatus;
          invited_by?: string | null;
          invited_at?: string;
          joined_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string | null;
          email?: string;
          role?: UserRole;
          status?: MembershipStatus;
          invited_by?: string | null;
          invited_at?: string;
          joined_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_members_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_invited_by_fkey";
            columns: ["invited_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      contacts: {
        Row: {
          id: string;
          organization_id: string;
          email: string | null;
          full_name: string | null;
          company: string | null;
          job_title: string | null;
          phone: string | null;
          tags: string[];
          source: string | null;
          notes: string | null;
          custom_fields: Json;
          created_by: string | null;
          assigned_to: string | null;
          last_contacted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          email?: string | null;
          full_name?: string | null;
          company?: string | null;
          job_title?: string | null;
          phone?: string | null;
          tags?: string[];
          source?: string | null;
          notes?: string | null;
          custom_fields?: Json;
          created_by?: string | null;
          assigned_to?: string | null;
          last_contacted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string | null;
          full_name?: string | null;
          company?: string | null;
          job_title?: string | null;
          phone?: string | null;
          tags?: string[];
          source?: string | null;
          notes?: string | null;
          custom_fields?: Json;
          created_by?: string | null;
          assigned_to?: string | null;
          last_contacted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_assigned_to_fkey";
            columns: ["assigned_to"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      tasks: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          parent_task_id: string | null;
          contact_id: string | null;
          created_by: string;
          assigned_to: string | null;
          due_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          agent_run_id: string | null;
          requires_approval: boolean;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          parent_task_id?: string | null;
          contact_id?: string | null;
          created_by: string;
          assigned_to?: string | null;
          due_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          agent_run_id?: string | null;
          requires_approval?: boolean;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          title?: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          parent_task_id?: string | null;
          contact_id?: string | null;
          created_by?: string;
          assigned_to?: string | null;
          due_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          agent_run_id?: string | null;
          requires_approval?: boolean;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey";
            columns: ["parent_task_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_contact_id_fkey";
            columns: ["contact_id"];
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_agent_run_id_fkey";
            columns: ["agent_run_id"];
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          }
        ];
      };

      agent_runs: {
        Row: {
          id: string;
          organization_id: string;
          agent_type: string;
          status: AgentRunStatus;
          input_data: Json;
          output_data: Json | null;
          error_message: string | null;
          task_id: string | null;
          triggered_by: string;
          requires_approval: boolean;
          approval_id: string | null;
          queued_at: string;
          started_at: string | null;
          completed_at: string | null;
          tokens_used: number | null;
          cost_cents: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          agent_type: string;
          status?: AgentRunStatus;
          input_data?: Json;
          output_data?: Json | null;
          error_message?: string | null;
          task_id?: string | null;
          triggered_by: string;
          requires_approval?: boolean;
          approval_id?: string | null;
          queued_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          tokens_used?: number | null;
          cost_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          agent_type?: string;
          status?: AgentRunStatus;
          input_data?: Json;
          output_data?: Json | null;
          error_message?: string | null;
          task_id?: string | null;
          triggered_by?: string;
          requires_approval?: boolean;
          approval_id?: string | null;
          queued_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          tokens_used?: number | null;
          cost_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_task_id_fkey";
            columns: ["task_id"];
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_triggered_by_fkey";
            columns: ["triggered_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_approval_id_fkey";
            columns: ["approval_id"];
            referencedRelation: "approvals";
            referencedColumns: ["id"];
          }
        ];
      };

      approvals: {
        Row: {
          id: string;
          organization_id: string;
          agent_run_id: string;
          action_type: string;
          action_summary: string;
          action_details: Json;
          status: ApprovalStatus;
          requested_by: string;
          requested_at: string;
          responded_by: string | null;
          responded_at: string | null;
          response_note: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          agent_run_id: string;
          action_type: string;
          action_summary: string;
          action_details?: Json;
          status?: ApprovalStatus;
          requested_by: string;
          requested_at?: string;
          responded_by?: string | null;
          responded_at?: string | null;
          response_note?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          agent_run_id?: string;
          action_type?: string;
          action_summary?: string;
          action_details?: Json;
          status?: ApprovalStatus;
          requested_by?: string;
          requested_at?: string;
          responded_by?: string | null;
          responded_at?: string | null;
          response_note?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_agent_run_id_fkey";
            columns: ["agent_run_id"];
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_requested_by_fkey";
            columns: ["requested_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_responded_by_fkey";
            columns: ["responded_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      integrations: {
        Row: {
          id: string;
          organization_id: string;
          provider: IntegrationProvider;
          name: string;
          status: IntegrationStatus;
          access_token_id: string | null;
          refresh_token_id: string | null;
          token_expires_at: string | null;
          scopes: string[];
          account_email: string | null;
          account_id: string | null;
          config: Json;
          webhook_secret_id: string | null;
          last_sync_at: string | null;
          last_error: string | null;
          error_count: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider: IntegrationProvider;
          name: string;
          status?: IntegrationStatus;
          access_token_id?: string | null;
          refresh_token_id?: string | null;
          token_expires_at?: string | null;
          scopes?: string[];
          account_email?: string | null;
          account_id?: string | null;
          config?: Json;
          webhook_secret_id?: string | null;
          last_sync_at?: string | null;
          last_error?: string | null;
          error_count?: number;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: IntegrationProvider;
          name?: string;
          status?: IntegrationStatus;
          access_token_id?: string | null;
          refresh_token_id?: string | null;
          token_expires_at?: string | null;
          scopes?: string[];
          account_email?: string | null;
          account_id?: string | null;
          config?: Json;
          webhook_secret_id?: string | null;
          last_sync_at?: string | null;
          last_error?: string | null;
          error_count?: number;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integrations_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "integrations_created_by_fkey";
            columns: ["created_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };

      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          actor_id: string;
          action: string;
          resource_type: string;
          resource_id: string | null;
          metadata: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          request_id: string | null;
          duration_ms: number | null;
          severity: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          actor_id: string;
          action: string;
          resource_type: string;
          resource_id?: string | null;
          metadata?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          request_id?: string | null;
          duration_ms?: number | null;
          severity?: string;
          created_at?: string;
        };
        Update: never; // Audit logs are immutable
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
    };

    Views: {
      active_tasks: {
        Row: {
          id: string;
          organization_id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          assigned_to: string | null;
          assigned_to_name: string | null;
          contact_id: string | null;
          contact_name: string | null;
          due_at: string | null;
          created_at: string;
        };
      };
      pending_approvals: {
        Row: {
          id: string;
          organization_id: string;
          agent_run_id: string;
          agent_type: string;
          action_type: string;
          action_summary: string;
          requested_by: string;
          requested_by_name: string | null;
          requested_at: string;
          expires_at: string | null;
        };
      };
    };

    Functions: {
      is_org_member: {
        Args: { check_org_id: string };
        Returns: boolean;
      };
      current_org_role: {
        Args: { check_org_id: string };
        Returns: UserRole | null;
      };
      has_org_role: {
        Args: { check_org_id: string; required_role: UserRole };
        Returns: boolean;
      };
      get_current_org_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      has_role: {
        Args: { required_role: UserRole };
        Returns: boolean;
      };
      create_audit_log: {
        Args: {
          p_action: string;
          p_resource_type: string;
          p_resource_id?: string;
          p_metadata?: Json;
          p_severity?: string;
        };
        Returns: string;
      };
    };

    Enums: {
      user_role: UserRole;
      membership_status: MembershipStatus;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      approval_status: ApprovalStatus;
      agent_run_status: AgentRunStatus;
      integration_provider: IntegrationProvider;
      integration_status: IntegrationStatus;
    };

    CompositeTypes: Record<string, never>;
  };
}

// =============================================================================
// Convenience Type Aliases
// =============================================================================

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Insertable<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type Updatable<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

// Table Row Types
export type Organization = Tables<"organizations">;
export type Profile = Tables<"profiles">;
export type OrgMember = Tables<"org_members">;
export type Contact = Tables<"contacts">;
export type Task = Tables<"tasks">;
export type AgentRun = Tables<"agent_runs">;
export type Approval = Tables<"approvals">;
export type Integration = Tables<"integrations">;
export type AuditLog = Tables<"audit_logs">;
