/**
 * Tipos do banco (identidade, categorias, contas, cartões, movimentações, faturas, parcelas, tags, views financeiras,
 * recorrências, dívidas, cofrinhos e objetivos, Open Finance e RPCs). Gerado com `generate_typescript_types` do Supabase (2026-10-07) —
 * regenerar a cada nova migration.
 */
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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          household_id: string
          icon: string
          id: string
          include_in_net_worth: boolean
          initial_balance_cents: number
          institution: string | null
          is_active: boolean
          name: string
          owner_profile_id: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          household_id: string
          icon?: string
          id?: string
          include_in_net_worth?: boolean
          initial_balance_cents?: number
          institution?: string | null
          is_active?: boolean
          name: string
          owner_profile_id: string
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          icon?: string
          id?: string
          include_in_net_worth?: boolean
          initial_balance_cents?: number
          institution?: string | null
          is_active?: boolean
          name?: string
          owner_profile_id?: string
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_profile_fk"
            columns: ["household_id", "owner_profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      bank_balances: {
        Row: {
          account_id: string | null
          available_limit_cents: number | null
          balance_cents: number
          connection_id: string
          credit_limit_cents: number | null
          currency: string
          external_account_id: string
          household_id: string
          id: string
          name: string
          number: string | null
          subtype: string | null
          synced_at: string
          type: string
        }
        Insert: {
          account_id?: string | null
          available_limit_cents?: number | null
          balance_cents: number
          connection_id: string
          credit_limit_cents?: number | null
          currency?: string
          external_account_id: string
          household_id: string
          id?: string
          name: string
          number?: string | null
          subtype?: string | null
          synced_at?: string
          type: string
        }
        Update: {
          account_id?: string | null
          available_limit_cents?: number | null
          balance_cents?: number
          connection_id?: string
          credit_limit_cents?: number | null
          currency?: string
          external_account_id?: string
          household_id?: string
          id?: string
          name?: string
          number?: string | null
          subtype?: string | null
          synced_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_balances_connection_fk"
            columns: ["household_id", "connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "bank_balances_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "bank_balances_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_connections: {
        Row: {
          created_at: string
          created_by: string | null
          credential_key: string
          household_id: string
          id: string
          institution: string | null
          item_id: string
          last_error: string | null
          last_synced_at: string | null
          owner_profile_id: string
          provider: string
          status: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credential_key: string
          household_id: string
          id?: string
          institution?: string | null
          item_id: string
          last_error?: string | null
          last_synced_at?: string | null
          owner_profile_id: string
          provider?: string
          status?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credential_key?: string
          household_id?: string
          id?: string
          institution?: string | null
          item_id?: string
          last_error?: string | null
          last_synced_at?: string | null
          owner_profile_id?: string
          provider?: string
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_connections_owner_profile_fk"
            columns: ["household_id", "owner_profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "bank_connections_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      card_invoices: {
        Row: {
          card_id: string
          closing_date: string
          created_at: string
          due_date: string
          due_month: string
          household_id: string
          id: string
        }
        Insert: {
          card_id: string
          closing_date: string
          created_at?: string
          due_date: string
          due_month: string
          household_id: string
          id?: string
        }
        Update: {
          card_id?: string
          closing_date?: string
          created_at?: string
          due_date?: string
          due_month?: string
          household_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_invoices_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "card_invoices_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "v_card_usage"
            referencedColumns: ["household_id", "card_id"]
          },
          {
            foreignKeyName: "card_invoices_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          household_id: string
          icon: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          household_id: string
          icon?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["category_kind"]
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          icon?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["category_kind"]
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_fk"
            columns: ["household_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      credit_cards: {
        Row: {
          brand: Database["public"]["Enums"]["card_brand"] | null
          closing_day: number
          color: string
          created_at: string
          created_by: string | null
          due_day: number
          household_id: string
          id: string
          is_active: boolean
          last4: string | null
          limit_cents: number
          name: string
          owner_profile_id: string
          payment_account_id: string | null
          updated_at: string
        }
        Insert: {
          brand?: Database["public"]["Enums"]["card_brand"] | null
          closing_day: number
          color?: string
          created_at?: string
          created_by?: string | null
          due_day: number
          household_id: string
          id?: string
          is_active?: boolean
          last4?: string | null
          limit_cents: number
          name: string
          owner_profile_id: string
          payment_account_id?: string | null
          updated_at?: string
        }
        Update: {
          brand?: Database["public"]["Enums"]["card_brand"] | null
          closing_day?: number
          color?: string
          created_at?: string
          created_by?: string | null
          due_day?: number
          household_id?: string
          id?: string
          is_active?: boolean
          last4?: string | null
          limit_cents?: number
          name?: string
          owner_profile_id?: string
          payment_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_cards_owner_profile_fk"
            columns: ["household_id", "owner_profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "credit_cards_payment_account_fk"
            columns: ["household_id", "payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "credit_cards_payment_account_fk"
            columns: ["household_id", "payment_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "credit_cards_payment_account_fk"
            columns: ["household_id", "payment_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
        ]
      }
      debts: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          creditor: string | null
          first_due_date: string | null
          household_id: string
          id: string
          installments_count: number | null
          kind: Database["public"]["Enums"]["debt_kind"]
          name: string
          notes: string | null
          payment_account_id: string | null
          principal_cents: number
          profile_id: string
          settled_at: string | null
          settlement_discount_cents: number | null
          status: Database["public"]["Enums"]["debt_status"]
          total_cents: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          creditor?: string | null
          first_due_date?: string | null
          household_id: string
          id?: string
          installments_count?: number | null
          kind?: Database["public"]["Enums"]["debt_kind"]
          name: string
          notes?: string | null
          payment_account_id?: string | null
          principal_cents: number
          profile_id: string
          settled_at?: string | null
          settlement_discount_cents?: number | null
          status?: Database["public"]["Enums"]["debt_status"]
          total_cents: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          creditor?: string | null
          first_due_date?: string | null
          household_id?: string
          id?: string
          installments_count?: number | null
          kind?: Database["public"]["Enums"]["debt_kind"]
          name?: string
          notes?: string | null
          payment_account_id?: string | null
          principal_cents?: number
          profile_id?: string
          settled_at?: string | null
          settlement_discount_cents?: number | null
          status?: Database["public"]["Enums"]["debt_status"]
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_category_fk"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "debts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_payment_account_fk"
            columns: ["household_id", "payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "debts_payment_account_fk"
            columns: ["household_id", "payment_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "debts_payment_account_fk"
            columns: ["household_id", "payment_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "debts_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      financial_profiles: {
        Row: {
          avatar_url: string | null
          color: string
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["profile_kind"]
          name: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["profile_kind"]
          name: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          color?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["profile_kind"]
          name?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_profiles_member_fk"
            columns: ["household_id", "user_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["household_id", "user_id"]
          },
        ]
      }
      goals: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          deadline: string | null
          description: string | null
          household_id: string
          icon: string
          id: string
          kind: string
          manual_amount_cents: number
          name: string
          pocket_id: string | null
          profile_id: string
          status: Database["public"]["Enums"]["goal_status"]
          target_cents: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          household_id: string
          icon?: string
          id?: string
          kind?: string
          manual_amount_cents?: number
          name: string
          pocket_id?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["goal_status"]
          target_cents: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          description?: string | null
          household_id?: string
          icon?: string
          id?: string
          kind?: string
          manual_amount_cents?: number
          name?: string
          pocket_id?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["goal_status"]
          target_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_pocket_fk"
            columns: ["household_id", "pocket_id"]
            isOneToOne: false
            referencedRelation: "pockets"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "goals_pocket_fk"
            columns: ["household_id", "pocket_id"]
            isOneToOne: false
            referencedRelation: "v_pocket_balances"
            referencedColumns: ["household_id", "pocket_id"]
          },
          {
            foreignKeyName: "goals_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      household_members: {
        Row: {
          created_at: string
          household_id: string
          role: Database["public"]["Enums"]["household_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          role?: Database["public"]["Enums"]["household_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          role?: Database["public"]["Enums"]["household_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      installment_purchases: {
        Row: {
          card_id: string
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string
          household_id: string
          id: string
          installments_count: number
          notes: string | null
          profile_id: string
          purchase_date: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          card_id: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          household_id: string
          id?: string
          installments_count: number
          notes?: string | null
          profile_id: string
          purchase_date: string
          total_cents: number
          updated_at?: string
        }
        Update: {
          card_id?: string
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          household_id?: string
          id?: string
          installments_count?: number
          notes?: string | null
          profile_id?: string
          purchase_date?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_purchases_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "installment_purchases_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "v_card_usage"
            referencedColumns: ["household_id", "card_id"]
          },
          {
            foreignKeyName: "installment_purchases_category_fk"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "installment_purchases_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_purchases_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      pocket_movements: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          kind: Database["public"]["Enums"]["pocket_movement_kind"]
          movement_date: string
          note: string | null
          pocket_id: string
          reverses_id: string | null
          transaction_id: string | null
          transfer_group_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          kind: Database["public"]["Enums"]["pocket_movement_kind"]
          movement_date: string
          note?: string | null
          pocket_id: string
          reverses_id?: string | null
          transaction_id?: string | null
          transfer_group_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["pocket_movement_kind"]
          movement_date?: string
          note?: string | null
          pocket_id?: string
          reverses_id?: string | null
          transaction_id?: string | null
          transfer_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pocket_movements_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pocket_movements_pocket_fk"
            columns: ["household_id", "pocket_id"]
            isOneToOne: false
            referencedRelation: "pockets"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "pocket_movements_pocket_fk"
            columns: ["household_id", "pocket_id"]
            isOneToOne: false
            referencedRelation: "v_pocket_balances"
            referencedColumns: ["household_id", "pocket_id"]
          },
          {
            foreignKeyName: "pocket_movements_reverses_fk"
            columns: ["household_id", "reverses_id"]
            isOneToOne: false
            referencedRelation: "pocket_movements"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "pocket_movements_tx_fk"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      pockets: {
        Row: {
          account_id: string
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          household_id: string
          icon: string
          id: string
          legacy_ref: string | null
          name: string
          profile_id: string
          status: Database["public"]["Enums"]["pocket_status"]
          updated_at: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          household_id: string
          icon?: string
          id?: string
          legacy_ref?: string | null
          name: string
          profile_id: string
          status?: Database["public"]["Enums"]["pocket_status"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          household_id?: string
          icon?: string
          id?: string
          legacy_ref?: string | null
          name?: string
          profile_id?: string
          status?: Database["public"]["Enums"]["pocket_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pockets_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "pockets_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "pockets_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "pockets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pockets_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      recurring_skips: {
        Row: {
          created_at: string
          household_id: string
          occurrence_date: string
          recurring_transaction_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          occurrence_date: string
          recurring_transaction_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          occurrence_date?: string
          recurring_transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_skips_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_skips_recurring_fk"
            columns: ["household_id", "recurring_transaction_id"]
            isOneToOne: false
            referencedRelation: "recurring_transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      recurring_transactions: {
        Row: {
          account_id: string | null
          amount_cents: number
          card_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          description: string
          end_date: string | null
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          household_id: string
          id: string
          interval_count: number
          is_active: boolean
          kind: Database["public"]["Enums"]["transaction_kind"]
          materialize_from: string
          notes: string | null
          profile_id: string
          start_date: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount_cents: number
          card_id?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          description: string
          end_date?: string | null
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          household_id: string
          id?: string
          interval_count?: number
          is_active?: boolean
          kind: Database["public"]["Enums"]["transaction_kind"]
          materialize_from: string
          notes?: string | null
          profile_id: string
          start_date: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          card_id?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          description?: string
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          household_id?: string
          id?: string
          interval_count?: number
          is_active?: boolean
          kind?: Database["public"]["Enums"]["transaction_kind"]
          materialize_from?: string
          notes?: string | null
          profile_id?: string
          start_date?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "recurring_transactions_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "recurring_transactions_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "recurring_transactions_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "recurring_transactions_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "v_card_usage"
            referencedColumns: ["household_id", "card_id"]
          },
          {
            foreignKeyName: "recurring_transactions_category_fk"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "recurring_transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_tags: {
        Row: {
          created_at: string
          household_id: string
          tag_id: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          tag_id: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          tag_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_tag_fk"
            columns: ["household_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_fk"
            columns: ["household_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount_cents: number
          canceled_by_rule: boolean
          card_id: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          date: string
          debt_id: string | null
          description: string
          due_date: string | null
          household_id: string
          id: string
          installment_number: number | null
          installment_purchase_id: string | null
          invoice_id: string | null
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes: string | null
          occurrence_date: string | null
          paid_at: string | null
          profile_id: string
          recurring_transaction_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          to_account_id: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount_cents: number
          canceled_by_rule?: boolean
          card_id?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          date: string
          debt_id?: string | null
          description: string
          due_date?: string | null
          household_id: string
          id?: string
          installment_number?: number | null
          installment_purchase_id?: string | null
          invoice_id?: string | null
          kind: Database["public"]["Enums"]["transaction_kind"]
          notes?: string | null
          occurrence_date?: string | null
          paid_at?: string | null
          profile_id: string
          recurring_transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          to_account_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount_cents?: number
          canceled_by_rule?: boolean
          card_id?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          debt_id?: string | null
          description?: string
          due_date?: string | null
          household_id?: string
          id?: string
          installment_number?: number | null
          installment_purchase_id?: string | null
          invoice_id?: string | null
          kind?: Database["public"]["Enums"]["transaction_kind"]
          notes?: string | null
          occurrence_date?: string | null
          paid_at?: string | null
          profile_id?: string
          recurring_transaction_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          to_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "transactions_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "transactions_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "v_card_usage"
            referencedColumns: ["household_id", "card_id"]
          },
          {
            foreignKeyName: "transactions_category_fk"
            columns: ["household_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_debt_fk"
            columns: ["household_id", "debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_debt_fk"
            columns: ["household_id", "debt_id"]
            isOneToOne: false
            referencedRelation: "v_debt_installments"
            referencedColumns: ["household_id", "debt_id"]
          },
          {
            foreignKeyName: "transactions_debt_fk"
            columns: ["household_id", "debt_id"]
            isOneToOne: false
            referencedRelation: "v_debt_summary"
            referencedColumns: ["household_id", "debt_id"]
          },
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_installment_purchase_fk"
            columns: ["household_id", "installment_purchase_id"]
            isOneToOne: false
            referencedRelation: "installment_purchases"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_invoice_fk"
            columns: ["household_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "card_invoices"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_invoice_fk"
            columns: ["household_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "v_card_invoice_totals"
            referencedColumns: ["household_id", "invoice_id"]
          },
          {
            foreignKeyName: "transactions_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_recurring_fk"
            columns: ["household_id", "recurring_transaction_id"]
            isOneToOne: false
            referencedRelation: "recurring_transactions"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_to_account_fk"
            columns: ["household_id", "to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "transactions_to_account_fk"
            columns: ["household_id", "to_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "transactions_to_account_fk"
            columns: ["household_id", "to_account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          last_household_id: string | null
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
          last_household_id?: string | null
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          last_household_id?: string | null
          locale?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_last_household_id_fkey"
            columns: ["last_household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_account_balances: {
        Row: {
          account_id: string | null
          balance_cents: number | null
          household_id: string | null
          initial_balance_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      v_account_reserves: {
        Row: {
          account_id: string | null
          balance_cents: number | null
          free_cents: number | null
          household_id: string | null
          reserved_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      v_card_invoice_totals: {
        Row: {
          card_id: string | null
          closing_date: string | null
          due_date: string | null
          due_month: string | null
          household_id: string | null
          invoice_id: string | null
          is_paid: boolean | null
          open_cents: number | null
          paid_cents: number | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "card_invoices_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "card_invoices_card_fk"
            columns: ["household_id", "card_id"]
            isOneToOne: false
            referencedRelation: "v_card_usage"
            referencedColumns: ["household_id", "card_id"]
          },
          {
            foreignKeyName: "card_invoices_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      v_card_usage: {
        Row: {
          available_cents: number | null
          card_id: string | null
          household_id: string | null
          limit_cents: number | null
          used_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_cards_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      v_debt_installments: {
        Row: {
          amount_cents: number | null
          debt_id: string | null
          due_date: string | null
          household_id: string | null
          is_overdue: boolean | null
          number: number | null
          open_cents: number | null
          paid_cents: number | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "debts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      v_debt_summary: {
        Row: {
          debt_id: string | null
          derived_status: string | null
          financial_cost_cents: number | null
          household_id: string | null
          installments_count: number | null
          installments_open: number | null
          installments_paid: number | null
          next_due_date: string | null
          next_open_cents: number | null
          paid_cents: number | null
          payments_count: number | null
          principal_cents: number | null
          progress_percent: number | null
          remaining_cents: number | null
          settled_at: string | null
          settlement_discount_cents: number | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "debts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      v_pocket_balances: {
        Row: {
          account_id: string | null
          balance_cents: number | null
          household_id: string | null
          pocket_id: string | null
          profile_id: string | null
          status: Database["public"]["Enums"]["pocket_status"] | null
        }
        Insert: {
          account_id?: string | null
          balance_cents?: never
          household_id?: string | null
          pocket_id?: string | null
          profile_id?: string | null
          status?: Database["public"]["Enums"]["pocket_status"] | null
        }
        Update: {
          account_id?: string | null
          balance_cents?: never
          household_id?: string | null
          pocket_id?: string | null
          profile_id?: string | null
          status?: Database["public"]["Enums"]["pocket_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "pockets_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["household_id", "id"]
          },
          {
            foreignKeyName: "pockets_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "pockets_account_fk"
            columns: ["household_id", "account_id"]
            isOneToOne: false
            referencedRelation: "v_account_reserves"
            referencedColumns: ["household_id", "account_id"]
          },
          {
            foreignKeyName: "pockets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pockets_profile_fk"
            columns: ["household_id", "profile_id"]
            isOneToOne: false
            referencedRelation: "financial_profiles"
            referencedColumns: ["household_id", "id"]
          },
        ]
      }
    }
    Functions: {
      bootstrap_household: {
        Args: {
          p_couple_profile_name?: string
          p_create_couple_profile?: boolean
          p_display_name: string
          p_household_name: string
        }
        Returns: string
      }
      create_debt: {
        Args: {
          p_category_id?: string
          p_creditor?: string
          p_first_due_date?: string
          p_installments?: number
          p_kind?: Database["public"]["Enums"]["debt_kind"]
          p_name: string
          p_notes?: string
          p_payment_account_id?: string
          p_principal_cents: number
          p_profile_id: string
          p_total_cents: number
        }
        Returns: string
      }
      create_installment_purchase: {
        Args: {
          p_card_id: string
          p_category_id: string
          p_description: string
          p_installments: number
          p_notes?: string
          p_profile_id: string
          p_purchase_date: string
          p_tags?: string[]
          p_total_cents: number
        }
        Returns: Json
      }
      create_pocket: {
        Args: {
          p_account_id: string
          p_color?: string
          p_date?: string
          p_description?: string
          p_icon?: string
          p_initial_cents?: number
          p_legacy_ref?: string
          p_name: string
          p_profile_id: string
        }
        Returns: string
      }
      create_recurring_transaction: {
        Args: {
          p_account_id?: string
          p_amount_cents: number
          p_card_id?: string
          p_category_id: string
          p_description: string
          p_end_date?: string
          p_frequency: Database["public"]["Enums"]["recurrence_frequency"]
          p_interval?: number
          p_kind: Database["public"]["Enums"]["transaction_kind"]
          p_notes?: string
          p_profile_id: string
          p_start_date: string
          p_tags?: string[]
        }
        Returns: Json
      }
      create_transaction: {
        Args: {
          p_account_id?: string
          p_amount_cents: number
          p_card_id?: string
          p_category_id?: string
          p_date: string
          p_description: string
          p_due_date?: string
          p_kind: Database["public"]["Enums"]["transaction_kind"]
          p_notes?: string
          p_paid_at?: string
          p_profile_id: string
          p_status?: Database["public"]["Enums"]["transaction_status"]
          p_tags?: string[]
          p_to_account_id?: string
        }
        Returns: string
      }
      delete_installments: {
        Args: { p_scope: string; p_transaction_id: string }
        Returns: Json
      }
      invoice_cycle: {
        Args: {
          p_closing_day: number
          p_due_day: number
          p_purchase_date: string
        }
        Returns: {
          closing_date: string
          due_date: string
          due_month: string
        }[]
      }
      link_goal_pocket: {
        Args: { p_goal_id: string; p_pocket_id?: string }
        Returns: undefined
      }
      pay_debt: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_date: string
          p_debt_id: string
        }
        Returns: string
      }
      pay_invoice: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_card_id: string
          p_date: string
          p_due_month: string
        }
        Returns: string
      }
      pocket_reserve: {
        Args: {
          p_amount_cents: number
          p_date?: string
          p_note?: string
          p_pocket_id: string
        }
        Returns: string
      }
      pocket_transfer: {
        Args: {
          p_amount_cents: number
          p_date?: string
          p_from_pocket_id: string
          p_note?: string
          p_to_pocket_id: string
        }
        Returns: string
      }
      pocket_withdraw: {
        Args: {
          p_amount_cents: number
          p_date?: string
          p_note?: string
          p_pocket_id: string
        }
        Returns: string
      }
      record_bank_sync: {
        Args: {
          p_accounts?: Json
          p_connection_id: string
          p_error?: string
          p_institution?: string
          p_status: string
        }
        Returns: undefined
      }
      recurrence_dates: {
        Args: {
          p_anchor: string
          p_frequency: Database["public"]["Enums"]["recurrence_frequency"]
          p_from: string
          p_interval: number
          p_to: string
        }
        Returns: string[]
      }
      reopen_debt: { Args: { p_id: string }; Returns: undefined }
      reverse_pocket_use: {
        Args: { p_note?: string; p_transaction_id: string }
        Returns: string
      }
      seed_default_categories: {
        Args: { p_household_id: string }
        Returns: number
      }
      set_debt_status: {
        Args: {
          p_id: string
          p_status: Database["public"]["Enums"]["debt_status"]
        }
        Returns: undefined
      }
      set_pocket_archived: {
        Args: { p_archived: boolean; p_id: string }
        Returns: undefined
      }
      set_recurring_transaction_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: Json
      }
      set_transaction_tags: {
        Args: { p_tags: string[]; p_transaction_id: string }
        Returns: undefined
      }
      settle_debt: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_date: string
          p_debt_id: string
        }
        Returns: Json
      }
      spend_from_pocket: {
        Args: {
          p_amount_cents: number
          p_amount_from_pocket?: number
          p_category_id?: string
          p_date?: string
          p_description: string
          p_notes?: string
          p_pocket_id: string
          p_profile_id?: string
          p_tags?: string[]
        }
        Returns: Json
      }
      split_cents: {
        Args: { p_parts: number; p_total_cents: number }
        Returns: number[]
      }
      sync_recurring_transactions: {
        Args: { p_recurring_id?: string }
        Returns: Json
      }
      update_debt: { Args: { p_id: string; p_patch: Json }; Returns: undefined }
      update_installments: {
        Args: { p_patch: Json; p_scope: string; p_transaction_id: string }
        Returns: Json
      }
      update_pocket: {
        Args: { p_id: string; p_patch: Json }
        Returns: undefined
      }
      update_recurring_transaction: {
        Args: {
          p_apply_to_future?: boolean
          p_id: string
          p_patch: Json
          p_tags?: string[]
        }
        Returns: Json
      }
      update_transaction: {
        Args: { p_patch: Json; p_tags?: string[]; p_transaction_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_type:
        | "checking"
        | "digital"
        | "savings"
        | "wallet"
        | "cash"
        | "investment"
        | "other"
      card_brand: "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "other"
      category_kind: "income" | "expense" | "both"
      debt_kind:
        | "loan"
        | "financing"
        | "personal"
        | "external_installment"
        | "other"
      debt_status: "active" | "paused" | "canceled"
      goal_status: "active" | "paused" | "completed" | "canceled"
      household_role: "owner" | "member"
      pocket_movement_kind:
        | "reserve"
        | "withdraw"
        | "transfer_in"
        | "transfer_out"
        | "use"
        | "use_reversal"
      pocket_status: "active" | "archived"
      profile_kind: "individual" | "shared"
      recurrence_frequency: "weekly" | "monthly" | "yearly"
      transaction_kind:
        | "income"
        | "expense"
        | "credit_card_purchase"
        | "transfer"
        | "card_payment"
        | "debt_payment"
        | "investment"
        | "redemption"
      transaction_status: "planned" | "pending" | "paid" | "canceled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      account_type: [
        "checking",
        "digital",
        "savings",
        "wallet",
        "cash",
        "investment",
        "other",
      ],
      card_brand: ["visa", "mastercard", "elo", "amex", "hipercard", "other"],
      category_kind: ["income", "expense", "both"],
      debt_kind: [
        "loan",
        "financing",
        "personal",
        "external_installment",
        "other",
      ],
      debt_status: ["active", "paused", "canceled"],
      goal_status: ["active", "paused", "completed", "canceled"],
      household_role: ["owner", "member"],
      pocket_movement_kind: [
        "reserve",
        "withdraw",
        "transfer_in",
        "transfer_out",
        "use",
        "use_reversal",
      ],
      pocket_status: ["active", "archived"],
      profile_kind: ["individual", "shared"],
      recurrence_frequency: ["weekly", "monthly", "yearly"],
      transaction_kind: [
        "income",
        "expense",
        "credit_card_purchase",
        "transfer",
        "card_payment",
        "debt_payment",
        "investment",
        "redemption",
      ],
      transaction_status: ["planned", "pending", "paid", "canceled"],
    },
  },
} as const
