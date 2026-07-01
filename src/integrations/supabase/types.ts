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
      ai_messages: {
        Row: {
          chapter_number: number | null
          committed: boolean
          content: string
          created_at: string
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          chapter_number?: number | null
          committed?: boolean
          content: string
          created_at?: string
          id?: string
          project_id: string
          role: string
          user_id: string
        }
        Update: {
          chapter_number?: number | null
          committed?: boolean
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      context_snapshots: {
        Row: {
          created_at: string
          id: string
          model: string
          prompt_hash: string | null
          snapshot_data: Json
          token_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          model?: string
          prompt_hash?: string | null
          snapshot_data?: Json
          token_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          model?: string
          prompt_hash?: string | null
          snapshot_data?: Json
          token_count?: number
          user_id?: string
        }
        Relationships: []
      }
      failure_log: {
        Row: {
          created_at: string
          id: string
          occurrence_count: number
          pattern_id: string | null
          resolved: boolean
          severity: string
          updated_at: string
          user_id: string
          violation_text: string
        }
        Insert: {
          created_at?: string
          id?: string
          occurrence_count?: number
          pattern_id?: string | null
          resolved?: boolean
          severity?: string
          updated_at?: string
          user_id: string
          violation_text: string
        }
        Update: {
          created_at?: string
          id?: string
          occurrence_count?: number
          pattern_id?: string | null
          resolved?: boolean
          severity?: string
          updated_at?: string
          user_id?: string
          violation_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "failure_log_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "style_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          chapter_number: number
          claimed_at: string | null
          created_at: string
          draft_text: string
          error: string | null
          id: string
          kernel_slug: string | null
          kernel_user: string | null
          message_id: string | null
          model: string
          params: Json
          phase: string
          project_id: string
          round: number
          status: string
          updated_at: string
          user_id: string
          working_text: string
        }
        Insert: {
          chapter_number: number
          claimed_at?: string | null
          created_at?: string
          draft_text?: string
          error?: string | null
          id?: string
          kernel_slug?: string | null
          kernel_user?: string | null
          message_id?: string | null
          model?: string
          params?: Json
          phase?: string
          project_id: string
          round?: number
          status?: string
          updated_at?: string
          user_id: string
          working_text?: string
        }
        Update: {
          chapter_number?: number
          claimed_at?: string | null
          created_at?: string
          draft_text?: string
          error?: string | null
          id?: string
          kernel_slug?: string | null
          kernel_user?: string | null
          message_id?: string | null
          model?: string
          params?: Json
          phase?: string
          project_id?: string
          round?: number
          status?: string
          updated_at?: string
          user_id?: string
          working_text?: string
        }
        Relationships: []
      }
      golden_examples: {
        Row: {
          content: string
          created_at: string
          fidelity_score: number
          id: string
          prompt_summary: string | null
          source: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          fidelity_score: number
          id?: string
          prompt_summary?: string | null
          source?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          fidelity_score?: number
          id?: string
          prompt_summary?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      kaggle_endpoints: {
        Row: {
          api_key: string | null
          created_at: string
          id: string
          model_id: string
          notes: string | null
          tunnel_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key?: string | null
          created_at?: string
          id?: string
          model_id: string
          notes?: string | null
          tunnel_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string | null
          created_at?: string
          id?: string
          model_id?: string
          notes?: string | null
          tunnel_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_triples: {
        Row: {
          category: string
          confidence: number
          created_at: string
          id: string
          last_reinforced_at: string | null
          locked: boolean
          object_value: string
          predicate: string
          sessions_below_threshold: number
          source_pattern_id: string | null
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          last_reinforced_at?: string | null
          locked?: boolean
          object_value: string
          predicate: string
          sessions_below_threshold?: number
          source_pattern_id?: string | null
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          id?: string
          last_reinforced_at?: string | null
          locked?: boolean
          object_value?: string
          predicate?: string
          sessions_below_threshold?: number
          source_pattern_id?: string | null
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_triples_source_pattern_id_fkey"
            columns: ["source_pattern_id"]
            isOneToOne: false
            referencedRelation: "style_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_scores: {
        Row: {
          created_at: string
          id: string
          is_judge: boolean
          judge_scores: Json
          last_practiced_at: string | null
          model_id: string
          practice_count: number
          score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_judge?: boolean
          judge_scores?: Json
          last_practiced_at?: string | null
          model_id: string
          practice_count?: number
          score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_judge?: boolean
          judge_scores?: Json
          last_practiced_at?: string | null
          model_id?: string
          practice_count?: number
          score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          document_content: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_content?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_content?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      session_history: {
        Row: {
          created_at: string
          fidelity_score: number | null
          id: string
          patterns_updated: number
          session_type: string
          summary: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fidelity_score?: number | null
          id?: string
          patterns_updated?: number
          session_type?: string
          summary: string
          user_id: string
        }
        Update: {
          created_at?: string
          fidelity_score?: number | null
          id?: string
          patterns_updated?: number
          session_type?: string
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      style_memory: {
        Row: {
          created_at: string
          detected_genre: string | null
          genre_conventions: Json
          id: string
          last_recached_at: string | null
          style_cache: string
          thematic_fingerprint: Json
          updated_at: string
          user_id: string
          voice_profile: Json
        }
        Insert: {
          created_at?: string
          detected_genre?: string | null
          genre_conventions?: Json
          id?: string
          last_recached_at?: string | null
          style_cache?: string
          thematic_fingerprint?: Json
          updated_at?: string
          user_id: string
          voice_profile?: Json
        }
        Update: {
          created_at?: string
          detected_genre?: string | null
          genre_conventions?: Json
          id?: string
          last_recached_at?: string | null
          style_cache?: string
          thematic_fingerprint?: Json
          updated_at?: string
          user_id?: string
          voice_profile?: Json
        }
        Relationships: []
      }
      style_patterns: {
        Row: {
          category: string
          checklist_question: string
          confidence: number
          created_at: string
          id: string
          last_reinforced_at: string | null
          locked: boolean
          pattern_text: string
          sessions_below_threshold: number
          source_file_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          checklist_question: string
          confidence?: number
          created_at?: string
          id?: string
          last_reinforced_at?: string | null
          locked?: boolean
          pattern_text: string
          sessions_below_threshold?: number
          source_file_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          checklist_question?: string
          confidence?: number
          created_at?: string
          id?: string
          last_reinforced_at?: string | null
          locked?: boolean
          pattern_text?: string
          sessions_below_threshold?: number
          source_file_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      token_usage: {
        Row: {
          completion_tokens: number
          created_at: string
          id: string
          model: string
          prompt_tokens: number
          source: string
          total_tokens: number
          user_id: string
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          id?: string
          model: string
          prompt_tokens?: number
          source?: string
          total_tokens?: number
          user_id: string
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          id?: string
          model?: string
          prompt_tokens?: number
          source?: string
          total_tokens?: number
          user_id?: string
        }
        Relationships: []
      }
      uploaded_files: {
        Row: {
          analyzed: boolean
          content: string
          content_hash: string | null
          created_at: string
          file_name: string
          file_type: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          analyzed?: boolean
          content: string
          content_hash?: string | null
          created_at?: string
          file_name: string
          file_type: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          analyzed?: boolean
          content?: string
          content_hash?: string | null
          created_at?: string
          file_name?: string
          file_type?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploaded_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_settings: {
        Row: {
          brainstorm_model: string | null
          chapter_number: number
          created_at: string
          fiction_type: string
          fiction_type_enabled: boolean
          id: string
          model: string
          perspective: string
          temperature: number
          top_p: number
          updated_at: string
          user_id: string
          word_count_max: number | null
          word_count_min: number | null
        }
        Insert: {
          brainstorm_model?: string | null
          chapter_number?: number
          created_at?: string
          fiction_type?: string
          fiction_type_enabled?: boolean
          id?: string
          model?: string
          perspective?: string
          temperature?: number
          top_p?: number
          updated_at?: string
          user_id: string
          word_count_max?: number | null
          word_count_min?: number | null
        }
        Update: {
          brainstorm_model?: string | null
          chapter_number?: number
          created_at?: string
          fiction_type?: string
          fiction_type_enabled?: boolean
          id?: string
          model?: string
          perspective?: string
          temperature?: number
          top_p?: number
          updated_at?: string
          user_id?: string
          word_count_max?: number | null
          word_count_min?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
