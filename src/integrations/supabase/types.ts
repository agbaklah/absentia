export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      app_settings: {
        Row: {
          carryover_cap_days: number;
          default_allowance_days: number;
          key: string;
          max_concurrent_absent: number;
          sick_threshold_days: number;
          working_days: number[];
        };
        Insert: {
          carryover_cap_days?: number;
          default_allowance_days?: number;
          key: string;
          max_concurrent_absent?: number;
          sick_threshold_days?: number;
          working_days?: number[];
        };
        Update: {
          carryover_cap_days?: number;
          default_allowance_days?: number;
          key?: string;
          max_concurrent_absent?: number;
          sick_threshold_days?: number;
          working_days?: number[];
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          after: Json | null;
          before: Json | null;
          entity: string;
          entity_id: string | null;
          id: string;
          ts: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          entity: string;
          entity_id?: string | null;
          id?: string;
          ts?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          entity?: string;
          entity_id?: string | null;
          id?: string;
          ts?: string;
        };
        Relationships: [];
      };
      leave_allowances: {
        Row: {
          adjustment_days: number;
          carried_over_days: number;
          employee_id: string;
          id: string;
          vacation_allowance_days: number;
          year: number;
        };
        Insert: {
          adjustment_days?: number;
          carried_over_days?: number;
          employee_id: string;
          id?: string;
          vacation_allowance_days?: number;
          year: number;
        };
        Update: {
          adjustment_days?: number;
          carried_over_days?: number;
          employee_id?: string;
          id?: string;
          vacation_allowance_days?: number;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "leave_allowances_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      leave_entries: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          date: string;
          decision_note: string | null;
          employee_id: string;
          id: string;
          leave_code: string;
          note: string | null;
          requested_by: string | null;
          status: Database["public"]["Enums"]["leave_status"];
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          date: string;
          decision_note?: string | null;
          employee_id: string;
          id?: string;
          leave_code: string;
          note?: string | null;
          requested_by?: string | null;
          status?: Database["public"]["Enums"]["leave_status"];
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          date?: string;
          decision_note?: string | null;
          employee_id?: string;
          id?: string;
          leave_code?: string;
          note?: string | null;
          requested_by?: string | null;
          status?: Database["public"]["Enums"]["leave_status"];
        };
        Relationships: [
          {
            foreignKeyName: "leave_entries_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_entries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_entries_leave_code_fkey";
            columns: ["leave_code"];
            isOneToOne: false;
            referencedRelation: "leave_types";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "leave_entries_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      leave_types: {
        Row: {
          category: string;
          code: string;
          colour_hex: string;
          counts_as_days: number;
          label: string;
        };
        Insert: {
          category: string;
          code: string;
          colour_hex: string;
          counts_as_days?: number;
          label: string;
        };
        Update: {
          category?: string;
          code?: string;
          colour_hex?: string;
          counts_as_days?: number;
          label?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          auth_user_id: string | null;
          created_at: string;
          email: string;
          employment_start_date: string;
          force_password_change: boolean;
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          team_id: string | null;
        };
        Insert: {
          active?: boolean;
          auth_user_id?: string | null;
          created_at?: string;
          email: string;
          employment_start_date?: string;
          force_password_change?: boolean;
          full_name: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          team_id?: string | null;
        };
        Update: {
          active?: boolean;
          auth_user_id?: string | null;
          created_at?: string;
          email?: string;
          employment_start_date?: string;
          force_password_change?: boolean;
          full_name?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      public_holidays: {
        Row: {
          date: string;
          id: string;
          name: string;
          region: string;
        };
        Insert: {
          date: string;
          id?: string;
          name: string;
          region?: string;
        };
        Update: {
          date?: string;
          id?: string;
          name?: string;
          region?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          created_at: string;
          id: string;
          manager_id: string | null;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          manager_id?: string | null;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          manager_id?: string | null;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_manager_fk";
            columns: ["manager_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_profile_id: { Args: never; Returns: string };
      current_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      current_team_id: { Args: never; Returns: string };
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"] };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "manager" | "employee" | "super_admin";
      leave_status: "pending" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "employee", "super_admin"],
      leave_status: ["pending", "approved", "rejected"],
    },
  },
} as const;
