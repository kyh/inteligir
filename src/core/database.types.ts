export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          operationName?: string;
          query?: string;
          variables?: Json;
          extensions?: Json;
        };
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
      chats: {
        Row: {
          created_at: string;
          id: number;
          model_id: number;
          name: string;
          project_id: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          model_id: number;
          name: string;
          project_id: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          model_id?: number;
          name?: string;
          project_id?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chats_model_id_fkey";
            columns: ["model_id"];
            referencedRelation: "models";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chats_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      domains: {
        Row: {
          created_at: string;
          id: number;
          project_id: number;
          updated_at: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          project_id: number;
          updated_at?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          project_id?: number;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "domains_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      file_sections: {
        Row: {
          content: string | null;
          embedding: string | null;
          files_id: number;
          id: number;
          token_count: number | null;
        };
        Insert: {
          content?: string | null;
          embedding?: string | null;
          files_id: number;
          id?: never;
          token_count?: number | null;
        };
        Update: {
          content?: string | null;
          embedding?: string | null;
          files_id?: number;
          id?: never;
          token_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "file_sections_files_id_fkey";
            columns: ["files_id"];
            referencedRelation: "files";
            referencedColumns: ["id"];
          }
        ];
      };
      files: {
        Row: {
          checksum: string | null;
          created_at: string;
          id: number;
          meta: Json | null;
          path: string;
          project_id: number;
          source_id: number;
          updated_at: string;
        };
        Insert: {
          checksum?: string | null;
          created_at?: string;
          id?: never;
          meta?: Json | null;
          path: string;
          project_id: number;
          source_id: number;
          updated_at?: string;
        };
        Update: {
          checksum?: string | null;
          created_at?: string;
          id?: never;
          meta?: Json | null;
          path?: string;
          project_id?: number;
          source_id?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "files_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_source_id_fkey";
            columns: ["source_id"];
            referencedRelation: "sources";
            referencedColumns: ["id"];
          }
        ];
      };
      memberships: {
        Row: {
          code: string | null;
          created_at: string;
          id: number;
          invited_email: string | null;
          organization_id: number;
          role: number;
          user_id: string | null;
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          id?: never;
          invited_email?: string | null;
          organization_id: number;
          role: number;
          user_id?: string | null;
        };
        Update: {
          code?: string | null;
          created_at?: string;
          id?: never;
          invited_email?: string | null;
          organization_id?: number;
          role?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      messages: {
        Row: {
          chat_id: number;
          content: string;
          created_at: string;
          id: number;
          sender: Database["public"]["Enums"]["message_sender_role"];
        };
        Insert: {
          chat_id: number;
          content: string;
          created_at?: string;
          id?: never;
          sender: Database["public"]["Enums"]["message_sender_role"];
        };
        Update: {
          chat_id?: number;
          content?: string;
          created_at?: string;
          id?: never;
          sender?: Database["public"]["Enums"]["message_sender_role"];
        };
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey";
            columns: ["chat_id"];
            referencedRelation: "chats";
            referencedColumns: ["id"];
          }
        ];
      };
      models: {
        Row: {
          created_at: string;
          frequency_penalty: number;
          id: number;
          instruction: string;
          max_tokens: number;
          model: Database["public"]["Enums"]["model_type"];
          name: string;
          organization_id: number;
          presence_penalty: number;
          temperature: number;
          top_p: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          frequency_penalty?: number;
          id?: never;
          instruction: string;
          max_tokens?: number;
          model?: Database["public"]["Enums"]["model_type"];
          name: string;
          organization_id: number;
          presence_penalty?: number;
          temperature?: number;
          top_p?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          frequency_penalty?: number;
          id?: never;
          instruction?: string;
          max_tokens?: number;
          model?: Database["public"]["Enums"]["model_type"];
          name?: string;
          organization_id?: number;
          presence_penalty?: number;
          temperature?: number;
          top_p?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "models_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: number;
          logo_url: string | null;
          name: string;
          uuid: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          logo_url?: string | null;
          name: string;
          uuid?: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          logo_url?: string | null;
          name?: string;
          uuid?: string;
        };
        Relationships: [];
      };
      organizations_plans_thresholds: {
        Row: {
          max_members: number;
          max_projects: number;
          organization_id: number;
          remaining_tokens: number;
        };
        Insert: {
          max_members: number;
          max_projects: number;
          organization_id: number;
          remaining_tokens: number;
        };
        Update: {
          max_members?: number;
          max_projects?: number;
          organization_id?: number;
          remaining_tokens?: number;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_plans_thresholds_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      organizations_subscriptions: {
        Row: {
          customer_id: string;
          organization_id: number;
          subscription_id: string | null;
        };
        Insert: {
          customer_id: string;
          organization_id: number;
          subscription_id?: string | null;
        };
        Update: {
          customer_id?: string;
          organization_id?: number;
          subscription_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_subscriptions_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organizations_subscriptions_subscription_id_fkey";
            columns: ["subscription_id"];
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          }
        ];
      };
      projects: {
        Row: {
          created_at: string;
          id: number;
          name: string;
          organization_id: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          name: string;
          organization_id: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          name?: string;
          organization_id?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      projects_memberships: {
        Row: {
          membership_id: number;
          project_id: number;
          role: Database["public"]["Enums"]["project_role"];
        };
        Insert: {
          membership_id: number;
          project_id: number;
          role: Database["public"]["Enums"]["project_role"];
        };
        Update: {
          membership_id?: number;
          project_id?: number;
          role?: Database["public"]["Enums"]["project_role"];
        };
        Relationships: [
          {
            foreignKeyName: "projects_memberships_membership_id_fkey";
            columns: ["membership_id"];
            referencedRelation: "memberships";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_memberships_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      sources: {
        Row: {
          created_at: string;
          data: Json | null;
          id: number;
          project_id: number;
          type: Database["public"]["Enums"]["source_type"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          data?: Json | null;
          id?: never;
          project_id: number;
          type: Database["public"]["Enums"]["source_type"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          data?: Json | null;
          id?: never;
          project_id?: number;
          type?: Database["public"]["Enums"]["source_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sources_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string | null;
          currency: string | null;
          id: string;
          interval: string | null;
          interval_count: number | null;
          period_ends_at: string | null;
          period_starts_at: string | null;
          price_id: string;
          status: Database["public"]["Enums"]["subscription_status"];
          trial_ends_at: string | null;
          trial_starts_at: string | null;
        };
        Insert: {
          cancel_at_period_end: boolean;
          created_at?: string | null;
          currency?: string | null;
          id: string;
          interval?: string | null;
          interval_count?: number | null;
          period_ends_at?: string | null;
          period_starts_at?: string | null;
          price_id: string;
          status: Database["public"]["Enums"]["subscription_status"];
          trial_ends_at?: string | null;
          trial_starts_at?: string | null;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string | null;
          currency?: string | null;
          id?: string;
          interval?: string | null;
          interval_count?: number | null;
          period_ends_at?: string | null;
          period_starts_at?: string | null;
          price_id?: string;
          status?: Database["public"]["Enums"]["subscription_status"];
          trial_ends_at?: string | null;
          trial_starts_at?: string | null;
        };
        Relationships: [];
      };
      tokens: {
        Row: {
          created_at: string;
          id: number;
          project_id: number;
          updated_at: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          id?: never;
          project_id: number;
          updated_at?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          project_id?: number;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tokens_project_id_fkey";
            columns: ["project_id"];
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      users: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          onboarded: boolean;
          photo_url: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          onboarded: boolean;
          photo_url?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          onboarded?: boolean;
          photo_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "users_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invite_to_organization: {
        Args: {
          invite_code: string;
          invite_user_id: string;
        };
        Returns: Json;
      };
      can_create_project: {
        Args: {
          org_id: number;
        };
        Returns: boolean;
      };
      can_invite_member: {
        Args: {
          org_id: number;
        };
        Returns: boolean;
      };
      can_update_user_role: {
        Args: {
          organization_id: number;
          membership_id: number;
        };
        Returns: boolean;
      };
      create_new_organization: {
        Args: {
          org_name: string;
          user_id: string;
          create_user?: boolean;
        };
        Returns: string;
      };
      create_new_project: {
        Args: {
          project_name: string;
          user_uuid: string;
          organization: number;
        };
        Returns: number;
      };
      current_user_is_member_of_organization: {
        Args: {
          organization_id: number;
        };
        Returns: boolean;
      };
      get_organizations_for_authenticated_user: {
        Args: Record<PropertyKey, never>;
        Returns: number[];
      };
      get_projects_for_authenticated_user: {
        Args: Record<PropertyKey, never>;
        Returns: number[];
      };
      get_role_for_authenticated_user: {
        Args: {
          org_id: number;
        };
        Returns: number;
      };
      get_role_for_user: {
        Args: {
          membership_id: number;
        };
        Returns: number;
      };
      is_project_owner: {
        Args: {
          id: number;
        };
        Returns: boolean;
      };
      ivfflathandler: {
        Args: {
          "": unknown;
        };
        Returns: unknown;
      };
      transfer_organization: {
        Args: {
          org_id: number;
          target_user_membership_id: number;
        };
        Returns: undefined;
      };
      vector_avg: {
        Args: {
          "": number[];
        };
        Returns: string;
      };
      vector_dims: {
        Args: {
          "": string;
        };
        Returns: number;
      };
      vector_norm: {
        Args: {
          "": string;
        };
        Returns: number;
      };
      vector_out: {
        Args: {
          "": string;
        };
        Returns: unknown;
      };
      vector_send: {
        Args: {
          "": string;
        };
        Returns: string;
      };
      vector_typmod_in: {
        Args: {
          "": unknown[];
        };
        Returns: number;
      };
    };
    Enums: {
      message_sender_role: "user" | "system" | "assistant";
      model_type: "gpt-3.5-turbo" | "gpt-4";
      project_role: "owner" | "admin" | "member";
      source_type: "github" | "website" | "file-upload" | "api-upload";
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "unpaid"
        | "incomplete"
        | "incomplete_expired"
        | "paused";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null;
          avif_autodetection: boolean | null;
          created_at: string | null;
          file_size_limit: number | null;
          id: string;
          name: string;
          owner: string | null;
          public: boolean | null;
          updated_at: string | null;
        };
        Insert: {
          allowed_mime_types?: string[] | null;
          avif_autodetection?: boolean | null;
          created_at?: string | null;
          file_size_limit?: number | null;
          id: string;
          name: string;
          owner?: string | null;
          public?: boolean | null;
          updated_at?: string | null;
        };
        Update: {
          allowed_mime_types?: string[] | null;
          avif_autodetection?: boolean | null;
          created_at?: string | null;
          file_size_limit?: number | null;
          id?: string;
          name?: string;
          owner?: string | null;
          public?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "buckets_owner_fkey";
            columns: ["owner"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      migrations: {
        Row: {
          executed_at: string | null;
          hash: string;
          id: number;
          name: string;
        };
        Insert: {
          executed_at?: string | null;
          hash: string;
          id: number;
          name: string;
        };
        Update: {
          executed_at?: string | null;
          hash?: string;
          id?: number;
          name?: string;
        };
        Relationships: [];
      };
      objects: {
        Row: {
          bucket_id: string | null;
          created_at: string | null;
          id: string;
          last_accessed_at: string | null;
          metadata: Json | null;
          name: string | null;
          owner: string | null;
          path_tokens: string[] | null;
          updated_at: string | null;
          version: string | null;
        };
        Insert: {
          bucket_id?: string | null;
          created_at?: string | null;
          id?: string;
          last_accessed_at?: string | null;
          metadata?: Json | null;
          name?: string | null;
          owner?: string | null;
          path_tokens?: string[] | null;
          updated_at?: string | null;
          version?: string | null;
        };
        Update: {
          bucket_id?: string | null;
          created_at?: string | null;
          id?: string;
          last_accessed_at?: string | null;
          metadata?: Json | null;
          name?: string | null;
          owner?: string | null;
          path_tokens?: string[] | null;
          updated_at?: string | null;
          version?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey";
            columns: ["bucket_id"];
            referencedRelation: "buckets";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_insert_object: {
        Args: {
          bucketid: string;
          name: string;
          owner: string;
          metadata: Json;
        };
        Returns: undefined;
      };
      extension: {
        Args: {
          name: string;
        };
        Returns: string;
      };
      filename: {
        Args: {
          name: string;
        };
        Returns: string;
      };
      foldername: {
        Args: {
          name: string;
        };
        Returns: unknown;
      };
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>;
        Returns: {
          size: number;
          bucket_id: string;
        }[];
      };
      search: {
        Args: {
          prefix: string;
          bucketname: string;
          limits?: number;
          levels?: number;
          offsets?: number;
          search?: string;
          sortcolumn?: string;
          sortorder?: string;
        };
        Returns: {
          name: string;
          id: string;
          updated_at: string;
          created_at: string;
          last_accessed_at: string;
          metadata: Json;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
