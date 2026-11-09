export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      barber_services: {
        Row: {
          barber_id: string;
          service_id: string;
        };
        Insert: {
          barber_id: string;
          service_id: string;
        };
        Update: {
          barber_id?: string;
          service_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "barber_services_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "barber_services_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      barbers: {
        Row: {
          bio: string | null;
          display_name: string;
          id: string;
          is_active: boolean;
          photo_path: string | null;
          profile_id: string | null;
        };
        Insert: {
          bio?: string | null;
          display_name: string;
          id?: string;
          is_active?: boolean;
          photo_path?: string | null;
          profile_id?: string | null;
        };
        Update: {
          bio?: string | null;
          display_name?: string;
          id?: string;
          is_active?: boolean;
          photo_path?: string | null;
          profile_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "barbers_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_staff_notes: {
        Row: {
          booking_id: string;
          note: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          booking_id: string;
          note: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          booking_id?: string;
          note?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_staff_notes_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_staff_notes_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          barber_id: string;
          blocked_until: string;
          buffer_min: number;
          created_at: string;
          customer_id: string | null;
          duration_min: number;
          ends_at: string;
          guest_name: string | null;
          guest_phone: string | null;
          id: string;
          notes: string | null;
          price_cents: number;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          starts_at: string;
          status: Database["public"]["Enums"]["booking_status"];
          status_changed_at: string;
          status_changed_by: string | null;
        };
        Insert: {
          barber_id: string;
          blocked_until: string;
          buffer_min: number;
          created_at?: string;
          customer_id?: string | null;
          duration_min: number;
          ends_at: string;
          guest_name?: string | null;
          guest_phone?: string | null;
          id?: string;
          notes?: string | null;
          price_cents: number;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          starts_at: string;
          status?: Database["public"]["Enums"]["booking_status"];
          status_changed_at: string;
          status_changed_by?: string | null;
        };
        Update: {
          barber_id?: string;
          blocked_until?: string;
          buffer_min?: number;
          created_at?: string;
          customer_id?: string | null;
          duration_min?: number;
          ends_at?: string;
          guest_name?: string | null;
          guest_phone?: string | null;
          id?: string;
          notes?: string | null;
          price_cents?: number;
          service_id?: string;
          source?: Database["public"]["Enums"]["booking_source"];
          starts_at?: string;
          status?: Database["public"]["Enums"]["booking_status"];
          status_changed_at?: string;
          status_changed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_status_changed_by_fkey";
            columns: ["status_changed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      login_code_attempts: {
        Row: {
          code_failures: number;
          email_hash: string;
          hour_failures: number;
          window_started_at: string | null;
        };
        Insert: {
          code_failures?: number;
          email_hash: string;
          hour_failures?: number;
          window_started_at?: string | null;
        };
        Update: {
          code_failures?: number;
          email_hash?: string;
          hour_failures?: number;
          window_started_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          is_blocked: boolean;
          marketing_consent: boolean;
          marketing_consent_at: string | null;
          no_show_count: number;
          no_show_reset_at: string | null;
          no_show_reset_by: string | null;
          phone: string | null;
          privacy_consent_at: string | null;
          privacy_policy_version: string | null;
          role: Database["public"]["Enums"]["user_role"];
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          is_blocked?: boolean;
          marketing_consent?: boolean;
          marketing_consent_at?: string | null;
          no_show_count?: number;
          no_show_reset_at?: string | null;
          no_show_reset_by?: string | null;
          phone?: string | null;
          privacy_consent_at?: string | null;
          privacy_policy_version?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          is_blocked?: boolean;
          marketing_consent?: boolean;
          marketing_consent_at?: string | null;
          no_show_count?: number;
          no_show_reset_at?: string | null;
          no_show_reset_by?: string | null;
          phone?: string | null;
          privacy_consent_at?: string | null;
          privacy_policy_version?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Relationships: [
          {
            foreignKeyName: "profiles_no_show_reset_by_fkey";
            columns: ["no_show_reset_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          description: string | null;
          duration_min: number;
          id: string;
          is_active: boolean;
          name: string;
          price_cents: number;
          sort_order: number;
        };
        Insert: {
          description?: string | null;
          duration_min: number;
          id?: string;
          is_active?: boolean;
          name: string;
          price_cents: number;
          sort_order?: number;
        };
        Update: {
          description?: string | null;
          duration_min?: number;
          id?: string;
          is_active?: boolean;
          name?: string;
          price_cents?: number;
          sort_order?: number;
        };
        Relationships: [];
      };
      shop_closures: {
        Row: {
          ends_at: string;
          id: string;
          reason: string | null;
          starts_at: string;
        };
        Insert: {
          ends_at: string;
          id?: string;
          reason?: string | null;
          starts_at: string;
        };
        Update: {
          ends_at?: string;
          id?: string;
          reason?: string | null;
          starts_at?: string;
        };
        Relationships: [];
      };
      shop_settings: {
        Row: {
          address: string | null;
          buffer_min: number;
          cancel_limit_min: number;
          id: boolean;
          logo_url: string | null;
          max_horizon_days: number;
          min_advance_min: number;
          name: string;
          no_show_block_threshold: number;
          phone: string | null;
          privacy_policy_version: string;
          slot_granularity_min: number;
          timezone: string;
        };
        Insert: {
          address?: string | null;
          buffer_min?: number;
          cancel_limit_min?: number;
          id?: boolean;
          logo_url?: string | null;
          max_horizon_days?: number;
          min_advance_min?: number;
          name: string;
          no_show_block_threshold?: number;
          phone?: string | null;
          privacy_policy_version?: string;
          slot_granularity_min?: number;
          timezone?: string;
        };
        Update: {
          address?: string | null;
          buffer_min?: number;
          cancel_limit_min?: number;
          id?: boolean;
          logo_url?: string | null;
          max_horizon_days?: number;
          min_advance_min?: number;
          name?: string;
          no_show_block_threshold?: number;
          phone?: string | null;
          privacy_policy_version?: string;
          slot_granularity_min?: number;
          timezone?: string;
        };
        Relationships: [];
      };
      time_off: {
        Row: {
          barber_id: string;
          ends_at: string;
          id: string;
          reason: string | null;
          starts_at: string;
        };
        Insert: {
          barber_id: string;
          ends_at: string;
          id?: string;
          reason?: string | null;
          starts_at: string;
        };
        Update: {
          barber_id?: string;
          ends_at?: string;
          id?: string;
          reason?: string | null;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_off_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
        ];
      };
      working_hours: {
        Row: {
          barber_id: string;
          end_time: string;
          id: string;
          start_time: string;
          weekday: number;
        };
        Insert: {
          barber_id: string;
          end_time: string;
          id?: string;
          start_time: string;
          weekday: number;
        };
        Update: {
          barber_id?: string;
          end_time?: string;
          id?: string;
          start_time?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "working_hours_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_booking_stats: {
        Args: { p_exclude_demo?: boolean; p_from: string; p_to: string };
        Returns: Json;
      };
      admin_customer: {
        Args: { p_id: string };
        Returns: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_blocked: boolean;
          no_show_count: number;
          no_show_reset_at: string;
          no_show_reset_by: string;
          phone: string;
        }[];
      };
      admin_customers: {
        Args: { p_limit?: number; p_offset?: number; q?: string };
        Returns: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_blocked: boolean;
          no_show_count: number;
          phone: string;
          total_count: number;
        }[];
      };
      availability_inputs: {
        Args: { p_barber_id: string; p_from: string; p_service_id: string; p_to: string };
        Returns: {
          barber_id: string;
          ends_at: string;
          kind: Database["public"]["Enums"]["availability_kind"];
          starts_at: string;
        }[];
      };
      availability_inputs_json: {
        Args: { p_barber_id: string; p_from: string; p_service_id: string; p_to: string };
        Returns: Json;
      };
      barber_accounts: {
        Args: Record<PropertyKey, never>;
        Returns: {
          barber_id: string;
          profile_id: string;
        }[];
      };
      blocked_customer_ids: { Args: { p_ids: string[] }; Returns: string[] };
      cancel_own_booking: { Args: { p_booking_id: string }; Returns: undefined };
      create_online_booking: {
        Args: { p_barber_id: string; p_notes: string; p_service_id: string; p_starts_at: string };
        Returns: string;
      };
      current_barber_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      fnv1a_32: { Args: { p_text: string }; Returns: number };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      local_band_to_interval: {
        Args: { p_date: string; p_end: string; p_start: string; p_tz: string };
        Returns: unknown;
      };
      login_code_check: {
        Args: { p_email: string };
        Returns: {
          blocked: boolean;
          remaining: number;
        }[];
      };
      login_code_clear: { Args: { p_email: string }; Returns: undefined };
      login_code_hash: { Args: { p_email: string }; Returns: string };
      login_code_register_failure: {
        Args: { p_email: string };
        Returns: {
          blocked: boolean;
          remaining: number;
        }[];
      };
      login_code_reset: { Args: { p_email: string }; Returns: undefined };
      login_code_status: {
        Args: { p_code_failures: number; p_hour_failures: number; p_window_started_at: string };
        Returns: {
          blocked: boolean;
          remaining: number;
        }[];
      };
      online_slot_error: {
        Args: { p_barber_id: string; p_service_id: string; p_starts_at: string };
        Returns: string;
      };
      online_slot_shop_error: {
        Args: { p_service_id: string; p_starts_at: string };
        Returns: string;
      };
      reorder_services: { Args: { p_ids: string[] }; Returns: undefined };
      reset_no_show_count: { Args: { p_customer_id: string }; Returns: undefined };
      revoke_user_sessions: { Args: { p_user_id: string }; Returns: undefined };
      search_customers: {
        Args: { q: string };
        Returns: {
          full_name: string;
          id: string;
          phone: string;
        }[];
      };
      set_working_hours: { Args: { p_barber_id: string; p_hours: Json }; Returns: undefined };
      shop_closures_on_local_day: {
        Args: { p_at: string };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      shop_closures_today: {
        Args: Record<PropertyKey, never>;
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      shop_opening_hours: {
        Args: Record<PropertyKey, never>;
        Returns: {
          end_time: string;
          start_time: string;
          weekday: number;
        }[];
      };
      timemultirange: { Args: Record<PropertyKey, never>; Returns: unknown };
    };
    Enums: {
      availability_kind: "work" | "time_off" | "closure" | "busy";
      booking_source: "online" | "manual";
      booking_status:
        | "confirmed"
        | "completed"
        | "cancelled_by_customer"
        | "cancelled_by_shop"
        | "no_show";
      user_role: "customer" | "barber" | "admin";
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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      availability_kind: ["work", "time_off", "closure", "busy"],
      booking_source: ["online", "manual"],
      booking_status: [
        "confirmed",
        "completed",
        "cancelled_by_customer",
        "cancelled_by_shop",
        "no_show",
      ],
      user_role: ["customer", "barber", "admin"],
    },
  },
} as const;
