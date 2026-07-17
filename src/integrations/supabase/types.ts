export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      consumer_details: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          assigned_secretary_id: string | null
          connection_date: string
          created_at: string
          device_id: string | null
          id: string
          location_id: string | null
          meter_id: string | null
          serial_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          assigned_secretary_id?: string | null
          connection_date?: string
          created_at?: string
          device_id?: string | null
          id?: string
          location_id?: string | null
          meter_id?: string | null
          serial_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          assigned_secretary_id?: string | null
          connection_date?: string
          created_at?: string
          device_id?: string | null
          id?: string
          location_id?: string | null
          meter_id?: string | null
          serial_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumer_details_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          bill_period_end: string
          bill_period_start: string
          chargeable_consumption: number
          consumer_id: string
          consumption: number
          created_at: string
          due_date: string
          free_consumption: number
          id: string
          late_fee: number
          meter_reading_id: string | null
          paid_at: string | null
          rate_applied: number
          status: Database["public"]["Enums"]["invoice_status"]
          total_amount: number
          updated_at: string
        }
        Insert: {
          amount?: number
          bill_period_end: string
          bill_period_start: string
          chargeable_consumption?: number
          consumer_id: string
          consumption?: number
          created_at?: string
          due_date: string
          free_consumption?: number
          id?: string
          late_fee?: number
          meter_reading_id?: string | null
          paid_at?: string | null
          rate_applied?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          bill_period_end?: string
          bill_period_start?: string
          chargeable_consumption?: number
          consumer_id?: string
          consumption?: number
          created_at?: string
          due_date?: string
          free_consumption?: number
          id?: string
          late_fee?: number
          meter_reading_id?: string | null
          paid_at?: string | null
          rate_applied?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_meter_reading_id_fkey"
            columns: ["meter_reading_id"]
            isOneToOne: false
            referencedRelation: "meter_readings"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      meter_readings: {
        Row: {
          consumer_id: string
          consumption: number
          created_at: string
          id: string
          meter_id: string
          notes: string | null
          previous_reading: number
          reading: number
          reading_date: string
          recorded_by: string | null
          source: Database["public"]["Enums"]["reading_source"]
        }
        Insert: {
          consumer_id: string
          consumption?: number
          created_at?: string
          id?: string
          meter_id: string
          notes?: string | null
          previous_reading?: number
          reading: number
          reading_date?: string
          recorded_by?: string | null
          source?: Database["public"]["Enums"]["reading_source"]
        }
        Update: {
          consumer_id?: string
          consumption?: number
          created_at?: string
          id?: string
          meter_id?: string
          notes?: string | null
          previous_reading?: number
          reading?: number
          reading_date?: string
          recorded_by?: string | null
          source?: Database["public"]["Enums"]["reading_source"]
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          consumer_id: string
          created_at: string
          id: string
          invoice_id: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          recorded_by: string | null
          transaction_id: string | null
        }
        Insert: {
          amount: number
          consumer_id: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          recorded_by?: string | null
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          consumer_id?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          recorded_by?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      prepaid_balances: {
        Row: {
          balance: number
          consumer_id: string
          last_recharge_amount: number | null
          last_recharge_date: string | null
          updated_at: string
        }
        Insert: {
          balance?: number
          consumer_id: string
          last_recharge_amount?: number | null
          last_recharge_date?: string | null
          updated_at?: string
        }
        Update: {
          balance?: number
          consumer_id?: string
          last_recharge_amount?: number | null
          last_recharge_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      secretary_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          secretary_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          secretary_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          secretary_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "secretary_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      water_rates: {
        Row: {
          created_at: string
          effective_from: string
          free_tier_liters: number
          id: string
          rate_per_liter: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          effective_from?: string
          free_tier_liters?: number
          id?: string
          rate_per_liter: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          effective_from?: string
          free_tier_liters?: number
          id?: string
          rate_per_liter?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      secretary_manages_consumer: {
        Args: { _consumer_id: string; _secretary_id: string }
        Returns: boolean
      }
    }
    Enums: {
      account_type: "prepaid" | "postpaid"
      app_role: "admin" | "secretary" | "consumer"
      invoice_status: "pending" | "approved" | "paid" | "overdue"
      payment_method: "online" | "manual" | "prepaid_recharge"
      reading_source: "smart_meter" | "manual"
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
  public: {
    Enums: {
      account_type: ["prepaid", "postpaid"],
      app_role: ["admin", "secretary", "consumer"],
      invoice_status: ["pending", "approved", "paid", "overdue"],
      payment_method: ["online", "manual", "prepaid_recharge"],
      reading_source: ["smart_meter", "manual"],
    },
  },
} as const
