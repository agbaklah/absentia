export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          carryover_cap_days: number
          company_name: string
          currency: string
          default_allowance_days: number
          holiday_region: string
          key: string
          max_concurrent_absent: number
          petty_cash_limit: number
          sick_threshold_days: number
          working_days: number[]
        }
        Insert: {
          carryover_cap_days?: number
          company_name?: string
          currency?: string
          default_allowance_days?: number
          holiday_region?: string
          key: string
          max_concurrent_absent?: number
          petty_cash_limit?: number
          sick_threshold_days?: number
          working_days?: number[]
        }
        Update: {
          carryover_cap_days?: number
          company_name?: string
          currency?: string
          default_allowance_days?: number
          holiday_region?: string
          key?: string
          max_concurrent_absent?: number
          petty_cash_limit?: number
          sick_threshold_days?: number
          working_days?: number[]
        }
        Relationships: []
      }
      approval_delegations: {
        Row: {
          created_at: string
          delegate_id: string
          delegator_id: string
          end_date: string
          id: string
          start_date: string
        }
        Insert: {
          created_at?: string
          delegate_id: string
          delegator_id: string
          end_date: string
          id?: string
          start_date?: string
        }
        Update: {
          created_at?: string
          delegate_id?: string
          delegator_id?: string
          end_date?: string
          id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          entity: string
          entity_id: string | null
          id: string
          ts: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          ts?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          ts?: string
        }
        Relationships: []
      }
      blackout_periods: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          reason: string
          start_date: string
          team_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          reason: string
          start_date: string
          team_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          reason?: string
          start_date?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blackout_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blackout_periods_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_claims: {
        Row: {
          amount: number
          category: string
          claim_no: number
          claimant_id: string
          created_at: string
          currency: string
          decision_note: string | null
          description: string | null
          expense_date: string
          id: string
          paid_at: string | null
          paid_by: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_ref: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["expense_status"]
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string
          claim_no?: number
          claimant_id: string
          created_at?: string
          currency?: string
          decision_note?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_ref?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          claim_no?: number
          claimant_id?: string
          created_at?: string
          currency?: string
          decision_note?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_ref?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["expense_status"]
          submitted_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_claims_claimant_id_fkey"
            columns: ["claimant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claims_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claims_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_receipts: {
        Row: {
          claim_id: string
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          claim_id: string
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          claim_id?: string
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_receipts_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "expense_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_allowances: {
        Row: {
          adjustment_days: number
          carried_over_days: number
          employee_id: string
          id: string
          sick_leave_allowance_days: number
          vacation_allowance_days: number
          year: number
        }
        Insert: {
          adjustment_days?: number
          carried_over_days?: number
          employee_id: string
          id?: string
          sick_leave_allowance_days?: number
          vacation_allowance_days?: number
          year: number
        }
        Update: {
          adjustment_days?: number
          carried_over_days?: number
          employee_id?: string
          id?: string
          sick_leave_allowance_days?: number
          vacation_allowance_days?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_allowances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balance_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          days: number
          employee_id: string
          id: string
          kind: string
          note: string | null
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days: number
          employee_id: string
          id?: string
          kind: string
          note?: string | null
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number
          employee_id?: string
          id?: string
          kind?: string
          note?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balance_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balance_transactions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attachment_url: string | null
          created_at: string
          date: string
          decision_note: string | null
          employee_id: string
          id: string
          leave_code: string
          note: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["leave_status"]
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          created_at?: string
          date: string
          decision_note?: string | null
          employee_id: string
          id?: string
          leave_code: string
          note?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attachment_url?: string | null
          created_at?: string
          date?: string
          decision_note?: string | null
          employee_id?: string
          id?: string
          leave_code?: string
          note?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["leave_status"]
        }
        Relationships: [
          {
            foreignKeyName: "leave_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_entries_leave_code_fkey"
            columns: ["leave_code"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "leave_entries_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_policies: {
        Row: {
          accrual_method: string
          allow_negative_balance: boolean
          annual_days: number
          carryover_cap_days: number
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          max_consecutive_days: number | null
          min_notice_days: number
          name: string
          sick_days: number
          waiting_period_days: number
        }
        Insert: {
          accrual_method?: string
          allow_negative_balance?: boolean
          annual_days?: number
          carryover_cap_days?: number
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          max_consecutive_days?: number | null
          min_notice_days?: number
          name: string
          sick_days?: number
          waiting_period_days?: number
        }
        Update: {
          accrual_method?: string
          allow_negative_balance?: boolean
          annual_days?: number
          carryover_cap_days?: number
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          max_consecutive_days?: number | null
          min_notice_days?: number
          name?: string
          sick_days?: number
          waiting_period_days?: number
        }
        Relationships: []
      }
      leave_types: {
        Row: {
          category: string
          code: string
          colour_hex: string
          counts_as_days: number
          label: string
        }
        Insert: {
          category: string
          code: string
          colour_hex: string
          counts_as_days?: number
          label: string
        }
        Update: {
          category?: string
          code?: string
          colour_hex?: string
          counts_as_days?: number
          label?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          email_sent_at: string | null
          id: string
          kind: string
          link: string | null
          read_at: string | null
          recipient_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          email_sent_at?: string | null
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          recipient_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          email_sent_at?: string | null
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          auth_user_id: string | null
          created_at: string
          email: string
          employment_start_date: string
          force_password_change: boolean
          full_name: string
          id: string
          password_changed_at: string | null
          policy_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          team_id: string | null
          temp_password_expires_at: string | null
          temp_password_hash: string | null
        }
        Insert: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          email: string
          employment_start_date?: string
          force_password_change?: boolean
          full_name: string
          id?: string
          password_changed_at?: string | null
          policy_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string | null
          temp_password_expires_at?: string | null
          temp_password_hash?: string | null
        }
        Update: {
          active?: boolean
          auth_user_id?: string | null
          created_at?: string
          email?: string
          employment_start_date?: string
          force_password_change?: boolean
          full_name?: string
          id?: string
          password_changed_at?: string | null
          policy_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string | null
          temp_password_expires_at?: string | null
          temp_password_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "leave_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      public_holidays: {
        Row: {
          date: string
          id: string
          name: string
          region: string
        }
        Insert: {
          date: string
          id?: string
          name: string
          region?: string
        }
        Update: {
          date?: string
          id?: string
          name?: string
          region?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          created_at: string
          id: string
          manager_id: string | null
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_manager_fk"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accrued_allowance: {
        Args: { _as_of?: string; _employee: string; _year: number }
        Returns: number
      }
      can_approve_for: { Args: { _employee: string }; Returns: boolean }
      can_decide_expenses: { Args: never; Returns: boolean }
      can_review_expenses: { Args: never; Returns: boolean }
      current_profile_id: { Args: never; Returns: string }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_team_id: { Args: never; Returns: string }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      leave_approvers_for: { Args: { _employee: string }; Returns: string[] }
      notify: {
        Args: {
          _body?: string
          _kind: string
          _link?: string
          _recipient: string
          _title: string
        }
        Returns: undefined
      }
      policy_for: {
        Args: { _employee: string }
        Returns: {
          accrual_method: string
          allow_negative_balance: boolean
          annual_days: number
          carryover_cap_days: number
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          max_consecutive_days: number | null
          min_notice_days: number
          name: string
          sick_days: number
          waiting_period_days: number
        }
        SetofOptions: {
          from: "*"
          to: "leave_policies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profile_role: {
        Args: { _profile_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      run_year_end_rollover: {
        Args: { _dry_run?: boolean; _from_year: number }
        Returns: Json
      }
      vacation_used: {
        Args: { _employee: string; _year: number }
        Returns: number
      }
      validate_leave_request: {
        Args: { _dates: string[]; _employee: string; _leave_code: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "employee" | "super_admin" | "cfo"
      expense_status: "draft" | "submitted" | "approved" | "rejected" | "paid"
      leave_status: "pending" | "approved" | "rejected" | "cancelled"
      payment_method: "cash" | "momo" | "bank_transfer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "manager", "employee", "super_admin", "cfo"],
      expense_status: ["draft", "submitted", "approved", "rejected", "paid"],
      leave_status: ["pending", "approved", "rejected", "cancelled"],
      payment_method: ["cash", "momo", "bank_transfer"],
    },
  },
} as const

