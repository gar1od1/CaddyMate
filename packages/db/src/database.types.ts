export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      club_condition_patterns: {
        Row: {
          bucket_key: string;
          club_id: string;
          engine_version: number;
          fitted_at: string;
          n_effective: number;
          params: NonNullable<Json>;
          user_id: string;
        };
        Insert: {
          bucket_key: string;
          club_id: string;
          engine_version: number;
          fitted_at?: string;
          n_effective?: number;
          params: NonNullable<Json>;
          user_id: string;
        };
        Update: {
          bucket_key?: string;
          club_id?: string;
          engine_version?: number;
          fitted_at?: string;
          n_effective?: number;
          params?: NonNullable<Json>;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'club_condition_patterns_club_id_fkey';
            columns: ['club_id'];
            isOneToOne: false;
            referencedRelation: 'clubs';
            referencedColumns: ['club_id'];
          },
          {
            foreignKeyName: 'club_condition_patterns_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      club_patterns: {
        Row: {
          club_id: string;
          confidence: Database['public']['Enums']['pattern_confidence'];
          engine_version: number;
          fitted_at: string;
          n_effective: number;
          n_raw: number;
          params: NonNullable<Json>;
          user_id: string;
        };
        Insert: {
          club_id: string;
          confidence?: Database['public']['Enums']['pattern_confidence'];
          engine_version: number;
          fitted_at?: string;
          n_effective?: number;
          n_raw?: number;
          params: NonNullable<Json>;
          user_id: string;
        };
        Update: {
          club_id?: string;
          confidence?: Database['public']['Enums']['pattern_confidence'];
          engine_version?: number;
          fitted_at?: string;
          n_effective?: number;
          n_raw?: number;
          params?: NonNullable<Json>;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'club_patterns_club_id_fkey';
            columns: ['club_id'];
            isOneToOne: false;
            referencedRelation: 'clubs';
            referencedColumns: ['club_id'];
          },
          {
            foreignKeyName: 'club_patterns_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      clubs: {
        Row: {
          active: boolean;
          bag_order: number;
          club_id: string;
          created_at: string;
          kind: Database['public']['Enums']['club_kind'];
          loft_deg: number | null;
          name: string;
          sim_name_aliases: string[];
          stock_carry_m: number | null;
          stock_total_m: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active?: boolean;
          bag_order?: number;
          club_id?: string;
          created_at?: string;
          kind: Database['public']['Enums']['club_kind'];
          loft_deg?: number | null;
          name: string;
          sim_name_aliases?: string[];
          stock_carry_m?: number | null;
          stock_total_m?: number | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active?: boolean;
          bag_order?: number;
          club_id?: string;
          created_at?: string;
          kind?: Database['public']['Enums']['club_kind'];
          loft_deg?: number | null;
          name?: string;
          sim_name_aliases?: string[];
          stock_carry_m?: number | null;
          stock_total_m?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clubs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      course_versions: {
        Row: {
          change_reason: string | null;
          course_id: string;
          created_at: string;
          created_by_user_id: string | null;
          version: number;
        };
        Insert: {
          change_reason?: string | null;
          course_id: string;
          created_at?: string;
          created_by_user_id?: string | null;
          version: number;
        };
        Update: {
          change_reason?: string | null;
          course_id?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'course_versions_course_id_fkey';
            columns: ['course_id'];
            isOneToOne: false;
            referencedRelation: 'courses';
            referencedColumns: ['course_id'];
          },
          {
            foreignKeyName: 'course_versions_created_by_user_id_fkey';
            columns: ['created_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      courses: {
        Row: {
          boundary_polygon: unknown;
          centroid: unknown;
          country: string;
          course_id: string;
          created_at: string;
          created_by_user_id: string | null;
          current_version: number;
          name: string;
          osm_relation_id: string | null;
          slug: string;
          source: Database['public']['Enums']['course_source'];
          status: Database['public']['Enums']['course_status'];
          updated_at: string;
        };
        Insert: {
          boundary_polygon?: unknown;
          centroid: unknown;
          country: string;
          course_id?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          current_version?: number;
          name: string;
          osm_relation_id?: string | null;
          slug: string;
          source?: Database['public']['Enums']['course_source'];
          status?: Database['public']['Enums']['course_status'];
          updated_at?: string;
        };
        Update: {
          boundary_polygon?: unknown;
          centroid?: unknown;
          country?: string;
          course_id?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          current_version?: number;
          name?: string;
          osm_relation_id?: string | null;
          slug?: string;
          source?: Database['public']['Enums']['course_source'];
          status?: Database['public']['Enums']['course_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'courses_created_by_user_id_fkey';
            columns: ['created_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      devices: {
        Row: {
          created_at: string;
          device_id: string;
          kind: Database['public']['Enums']['device_kind'];
          last_seen_at: string | null;
          user_id: string;
          watch_model: string | null;
        };
        Insert: {
          created_at?: string;
          device_id?: string;
          kind: Database['public']['Enums']['device_kind'];
          last_seen_at?: string | null;
          user_id: string;
          watch_model?: string | null;
        };
        Update: {
          created_at?: string;
          device_id?: string;
          kind?: Database['public']['Enums']['device_kind'];
          last_seen_at?: string | null;
          user_id?: string;
          watch_model?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'devices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      elevation_grids: {
        Row: {
          bbox: NonNullable<Json>;
          course_id: string;
          created_at: string;
          max_m: number | null;
          min_m: number | null;
          resolution_m: number;
          storage_path: string;
          version: number;
        };
        Insert: {
          bbox: NonNullable<Json>;
          course_id: string;
          created_at?: string;
          max_m?: number | null;
          min_m?: number | null;
          resolution_m: number;
          storage_path: string;
          version: number;
        };
        Update: {
          bbox?: NonNullable<Json>;
          course_id?: string;
          created_at?: string;
          max_m?: number | null;
          min_m?: number | null;
          resolution_m?: number;
          storage_path?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'elevation_grids_course_id_version_fkey';
            columns: ['course_id', 'version'];
            isOneToOne: true;
            referencedRelation: 'course_versions';
            referencedColumns: ['course_id', 'version'];
          },
        ];
      };
      hole_features: {
        Row: {
          feature_id: string;
          hole_id: string;
          kind: Database['public']['Enums']['feature_kind'];
          notes: string | null;
          penalty: Database['public']['Enums']['feature_penalty'];
          point: unknown;
          polygon: unknown;
          tree_height_m: number | null;
          tree_radius_m: number | null;
        };
        Insert: {
          feature_id?: string;
          hole_id: string;
          kind: Database['public']['Enums']['feature_kind'];
          notes?: string | null;
          penalty?: Database['public']['Enums']['feature_penalty'];
          point?: unknown;
          polygon?: unknown;
          tree_height_m?: number | null;
          tree_radius_m?: number | null;
        };
        Update: {
          feature_id?: string;
          hole_id?: string;
          kind?: Database['public']['Enums']['feature_kind'];
          notes?: string | null;
          penalty?: Database['public']['Enums']['feature_penalty'];
          point?: unknown;
          polygon?: unknown;
          tree_height_m?: number | null;
          tree_radius_m?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'hole_features_hole_id_fkey';
            columns: ['hole_id'];
            isOneToOne: false;
            referencedRelation: 'holes';
            referencedColumns: ['hole_id'];
          },
        ];
      };
      hole_scores: {
        Row: {
          hole_number: number;
          net_strokes: number | null;
          override_reason: string | null;
          penalties: number;
          points: number | null;
          putts: number;
          round_id: string;
          strokes_logged: number;
          strokes_override: number | null;
        };
        Insert: {
          hole_number: number;
          net_strokes?: number | null;
          override_reason?: string | null;
          penalties?: number;
          points?: number | null;
          putts?: number;
          round_id: string;
          strokes_logged?: number;
          strokes_override?: number | null;
        };
        Update: {
          hole_number?: number;
          net_strokes?: number | null;
          override_reason?: string | null;
          penalties?: number;
          points?: number | null;
          putts?: number;
          round_id?: string;
          strokes_logged?: number;
          strokes_override?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'hole_scores_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['round_id'];
          },
        ];
      };
      holes: {
        Row: {
          course_id: string;
          created_at: string;
          green_centre: unknown;
          green_polygon: unknown;
          hole_id: string;
          hole_number: number;
          line_of_play: unknown;
          par: number;
          version: number;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          green_centre?: unknown;
          green_polygon?: unknown;
          hole_id?: string;
          hole_number: number;
          line_of_play?: unknown;
          par: number;
          version: number;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          green_centre?: unknown;
          green_polygon?: unknown;
          hole_id?: string;
          hole_number?: number;
          line_of_play?: unknown;
          par?: number;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'holes_course_id_version_fkey';
            columns: ['course_id', 'version'];
            isOneToOne: false;
            referencedRelation: 'course_versions';
            referencedColumns: ['course_id', 'version'];
          },
        ];
      };
      permission: {
        Row: {
          description: string;
          module_key: string | null;
          page_key: string;
          page_view_key: string | null;
          permission_key: string;
          verb: Database['public']['Enums']['permission_verb'];
        };
        Insert: {
          description: string;
          module_key?: never;
          page_key: string;
          page_view_key?: never;
          permission_key: string;
          verb: Database['public']['Enums']['permission_verb'];
        };
        Update: {
          description?: string;
          module_key?: never;
          page_key?: string;
          page_view_key?: never;
          permission_key?: string;
          verb?: Database['public']['Enums']['permission_verb'];
        };
        Relationships: [
          {
            foreignKeyName: 'permission_page_view_key_fkey';
            columns: ['page_view_key'];
            isOneToOne: false;
            referencedRelation: 'permission';
            referencedColumns: ['permission_key'];
          },
        ];
      };
      profiles: {
        Row: {
          condition_overrides: NonNullable<Json>;
          created_at: string;
          default_shape: Database['public']['Enums']['shape'];
          display_name: string | null;
          handedness: Database['public']['Enums']['handedness'];
          handicap_index_official: number | null;
          home_course_id: string | null;
          plan: Database['public']['Enums']['plan'];
          recency_half_life_days: number;
          role: Database['public']['Enums']['app_role'];
          units: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          condition_overrides?: NonNullable<Json>;
          created_at?: string;
          default_shape?: Database['public']['Enums']['shape'];
          display_name?: string | null;
          handedness?: Database['public']['Enums']['handedness'];
          handicap_index_official?: number | null;
          home_course_id?: string | null;
          plan?: Database['public']['Enums']['plan'];
          recency_half_life_days?: number;
          role?: Database['public']['Enums']['app_role'];
          units?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          condition_overrides?: NonNullable<Json>;
          created_at?: string;
          default_shape?: Database['public']['Enums']['shape'];
          display_name?: string | null;
          handedness?: Database['public']['Enums']['handedness'];
          handicap_index_official?: number | null;
          home_course_id?: string | null;
          plan?: Database['public']['Enums']['plan'];
          recency_half_life_days?: number;
          role?: Database['public']['Enums']['app_role'];
          units?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_home_course_fk';
            columns: ['home_course_id'];
            isOneToOne: false;
            referencedRelation: 'courses';
            referencedColumns: ['course_id'];
          },
        ];
      };
      role_permission: {
        Row: {
          permission_key: string;
          role: Database['public']['Enums']['app_role'];
        };
        Insert: {
          permission_key: string;
          role: Database['public']['Enums']['app_role'];
        };
        Update: {
          permission_key?: string;
          role?: Database['public']['Enums']['app_role'];
        };
        Relationships: [
          {
            foreignKeyName: 'role_permission_permission_key_fkey';
            columns: ['permission_key'];
            isOneToOne: false;
            referencedRelation: 'permission';
            referencedColumns: ['permission_key'];
          },
        ];
      };
      rounds: {
        Row: {
          adjusted_gross: number | null;
          course_handicap: number | null;
          course_id: string;
          course_version: number;
          created_at: string;
          differential: number | null;
          finished_at: string | null;
          gross: number | null;
          handicap_index_used: number | null;
          pin_overrides: NonNullable<Json>;
          playing_handicap: number | null;
          round_id: string;
          stableford: number | null;
          started_at: string;
          status: Database['public']['Enums']['round_status'];
          tee_set_id: string;
          updated_at: string;
          user_id: string;
          weather_snapshot: Json | null;
        };
        Insert: {
          adjusted_gross?: number | null;
          course_handicap?: number | null;
          course_id: string;
          course_version: number;
          created_at?: string;
          differential?: number | null;
          finished_at?: string | null;
          gross?: number | null;
          handicap_index_used?: number | null;
          pin_overrides?: NonNullable<Json>;
          playing_handicap?: number | null;
          round_id?: string;
          stableford?: number | null;
          started_at?: string;
          status?: Database['public']['Enums']['round_status'];
          tee_set_id: string;
          updated_at?: string;
          user_id: string;
          weather_snapshot?: Json | null;
        };
        Update: {
          adjusted_gross?: number | null;
          course_handicap?: number | null;
          course_id?: string;
          course_version?: number;
          created_at?: string;
          differential?: number | null;
          finished_at?: string | null;
          gross?: number | null;
          handicap_index_used?: number | null;
          pin_overrides?: NonNullable<Json>;
          playing_handicap?: number | null;
          round_id?: string;
          stableford?: number | null;
          started_at?: string;
          status?: Database['public']['Enums']['round_status'];
          tee_set_id?: string;
          updated_at?: string;
          user_id?: string;
          weather_snapshot?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rounds_course_id_course_version_fkey';
            columns: ['course_id', 'course_version'];
            isOneToOne: false;
            referencedRelation: 'course_versions';
            referencedColumns: ['course_id', 'version'];
          },
          {
            foreignKeyName: 'rounds_course_id_fkey';
            columns: ['course_id'];
            isOneToOne: false;
            referencedRelation: 'courses';
            referencedColumns: ['course_id'];
          },
          {
            foreignKeyName: 'rounds_tee_set_id_fkey';
            columns: ['tee_set_id'];
            isOneToOne: false;
            referencedRelation: 'tee_sets';
            referencedColumns: ['tee_set_id'];
          },
          {
            foreignKeyName: 'rounds_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      sg_baselines: {
        Row: {
          baseline_id: string;
          category: string;
          distance_m: number;
          expected_strokes: number;
        };
        Insert: {
          baseline_id: string;
          category: string;
          distance_m: number;
          expected_strokes: number;
        };
        Update: {
          baseline_id?: string;
          category?: string;
          distance_m?: number;
          expected_strokes?: number;
        };
        Relationships: [];
      };
      shots: {
        Row: {
          club_id: string | null;
          condition_model_version: number | null;
          conditions: Json | null;
          created_at: string;
          decision_grade: Database['public']['Enums']['grade'] | null;
          distance_to_pin_after_m: number | null;
          distance_to_pin_before_m: number | null;
          end_accuracy_m: number | null;
          end_position: unknown;
          execution_grade: Database['public']['Enums']['grade'] | null;
          execution_loss: number | null;
          hole_number: number | null;
          holed: boolean;
          intended_shape: Database['public']['Enums']['shape'] | null;
          lie: Database['public']['Enums']['lie'] | null;
          neutral_distance_m: number | null;
          neutral_lateral_m: number | null;
          observed_distance_m: number | null;
          observed_lateral_m: number | null;
          penalty: Database['public']['Enums']['penalty'];
          played_at: string;
          putt_distance_m: number | null;
          putt_remaining_m: number | null;
          recommendation: Json | null;
          reconstructed: boolean;
          result_surface: Database['public']['Enums']['lie'] | null;
          round_id: string | null;
          seq: number | null;
          sg: number | null;
          sg_category: Database['public']['Enums']['sg_category'] | null;
          shot_id: string;
          sim_carry_m: number | null;
          sim_offline_m: number | null;
          sim_session_id: string | null;
          sim_total_m: number | null;
          slope_above: Database['public']['Enums']['slope_strength'];
          slope_below: Database['public']['Enums']['slope_strength'];
          slope_down: Database['public']['Enums']['slope_strength'];
          slope_suggested: Json | null;
          slope_up: Database['public']['Enums']['slope_strength'];
          source: Database['public']['Enums']['shot_source'];
          start_accuracy_m: number | null;
          start_position: unknown;
          strategy_loss: number | null;
          strike: Database['public']['Enums']['strike'];
          stroke_count: number;
          target_bearing_deg: number | null;
          target_point: unknown;
          target_ref: Json | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          club_id?: string | null;
          condition_model_version?: number | null;
          conditions?: Json | null;
          created_at?: string;
          decision_grade?: Database['public']['Enums']['grade'] | null;
          distance_to_pin_after_m?: number | null;
          distance_to_pin_before_m?: number | null;
          end_accuracy_m?: number | null;
          end_position?: unknown;
          execution_grade?: Database['public']['Enums']['grade'] | null;
          execution_loss?: number | null;
          hole_number?: number | null;
          holed?: boolean;
          intended_shape?: Database['public']['Enums']['shape'] | null;
          lie?: Database['public']['Enums']['lie'] | null;
          neutral_distance_m?: number | null;
          neutral_lateral_m?: number | null;
          observed_distance_m?: number | null;
          observed_lateral_m?: number | null;
          penalty?: Database['public']['Enums']['penalty'];
          played_at?: string;
          putt_distance_m?: number | null;
          putt_remaining_m?: number | null;
          recommendation?: Json | null;
          reconstructed?: boolean;
          result_surface?: Database['public']['Enums']['lie'] | null;
          round_id?: string | null;
          seq?: number | null;
          sg?: number | null;
          sg_category?: Database['public']['Enums']['sg_category'] | null;
          shot_id?: string;
          sim_carry_m?: number | null;
          sim_offline_m?: number | null;
          sim_session_id?: string | null;
          sim_total_m?: number | null;
          slope_above?: Database['public']['Enums']['slope_strength'];
          slope_below?: Database['public']['Enums']['slope_strength'];
          slope_down?: Database['public']['Enums']['slope_strength'];
          slope_suggested?: Json | null;
          slope_up?: Database['public']['Enums']['slope_strength'];
          source?: Database['public']['Enums']['shot_source'];
          start_accuracy_m?: number | null;
          start_position?: unknown;
          strategy_loss?: number | null;
          strike?: Database['public']['Enums']['strike'];
          stroke_count?: number;
          target_bearing_deg?: number | null;
          target_point?: unknown;
          target_ref?: Json | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          club_id?: string | null;
          condition_model_version?: number | null;
          conditions?: Json | null;
          created_at?: string;
          decision_grade?: Database['public']['Enums']['grade'] | null;
          distance_to_pin_after_m?: number | null;
          distance_to_pin_before_m?: number | null;
          end_accuracy_m?: number | null;
          end_position?: unknown;
          execution_grade?: Database['public']['Enums']['grade'] | null;
          execution_loss?: number | null;
          hole_number?: number | null;
          holed?: boolean;
          intended_shape?: Database['public']['Enums']['shape'] | null;
          lie?: Database['public']['Enums']['lie'] | null;
          neutral_distance_m?: number | null;
          neutral_lateral_m?: number | null;
          observed_distance_m?: number | null;
          observed_lateral_m?: number | null;
          penalty?: Database['public']['Enums']['penalty'];
          played_at?: string;
          putt_distance_m?: number | null;
          putt_remaining_m?: number | null;
          recommendation?: Json | null;
          reconstructed?: boolean;
          result_surface?: Database['public']['Enums']['lie'] | null;
          round_id?: string | null;
          seq?: number | null;
          sg?: number | null;
          sg_category?: Database['public']['Enums']['sg_category'] | null;
          shot_id?: string;
          sim_carry_m?: number | null;
          sim_offline_m?: number | null;
          sim_session_id?: string | null;
          sim_total_m?: number | null;
          slope_above?: Database['public']['Enums']['slope_strength'];
          slope_below?: Database['public']['Enums']['slope_strength'];
          slope_down?: Database['public']['Enums']['slope_strength'];
          slope_suggested?: Json | null;
          slope_up?: Database['public']['Enums']['slope_strength'];
          source?: Database['public']['Enums']['shot_source'];
          start_accuracy_m?: number | null;
          start_position?: unknown;
          strategy_loss?: number | null;
          strike?: Database['public']['Enums']['strike'];
          stroke_count?: number;
          target_bearing_deg?: number | null;
          target_point?: unknown;
          target_ref?: Json | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shots_club_id_fkey';
            columns: ['club_id'];
            isOneToOne: false;
            referencedRelation: 'clubs';
            referencedColumns: ['club_id'];
          },
          {
            foreignKeyName: 'shots_round_id_fkey';
            columns: ['round_id'];
            isOneToOne: false;
            referencedRelation: 'rounds';
            referencedColumns: ['round_id'];
          },
          {
            foreignKeyName: 'shots_sim_session_id_fkey';
            columns: ['sim_session_id'];
            isOneToOne: false;
            referencedRelation: 'sim_sessions';
            referencedColumns: ['session_id'];
          },
          {
            foreignKeyName: 'shots_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      sim_sessions: {
        Row: {
          ball_type: string | null;
          file_hash: string;
          imported_at: string;
          notes: string | null;
          raw_payload: Json | null;
          row_count: number;
          session_id: string;
          source: Database['public']['Enums']['sim_source'];
          user_id: string;
        };
        Insert: {
          ball_type?: string | null;
          file_hash: string;
          imported_at?: string;
          notes?: string | null;
          raw_payload?: Json | null;
          row_count?: number;
          session_id?: string;
          source: Database['public']['Enums']['sim_source'];
          user_id: string;
        };
        Update: {
          ball_type?: string | null;
          file_hash?: string;
          imported_at?: string;
          notes?: string | null;
          raw_payload?: Json | null;
          row_count?: number;
          session_id?: string;
          source?: Database['public']['Enums']['sim_source'];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sim_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['user_id'];
          },
        ];
      };
      tee_markers: {
        Row: {
          hole_id: string;
          marker_point: unknown;
          stroke_index: number | null;
          tee_id: string;
          tee_set_id: string;
          yardage_m: number | null;
        };
        Insert: {
          hole_id: string;
          marker_point: unknown;
          stroke_index?: number | null;
          tee_id?: string;
          tee_set_id: string;
          yardage_m?: number | null;
        };
        Update: {
          hole_id?: string;
          marker_point?: unknown;
          stroke_index?: number | null;
          tee_id?: string;
          tee_set_id?: string;
          yardage_m?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tee_markers_hole_id_fkey';
            columns: ['hole_id'];
            isOneToOne: false;
            referencedRelation: 'holes';
            referencedColumns: ['hole_id'];
          },
          {
            foreignKeyName: 'tee_markers_tee_set_id_fkey';
            columns: ['tee_set_id'];
            isOneToOne: false;
            referencedRelation: 'tee_sets';
            referencedColumns: ['tee_set_id'];
          },
        ];
      };
      tee_sets: {
        Row: {
          bogey_rating: number | null;
          colour_hex: string | null;
          course_id: string;
          course_rating: number | null;
          name: string;
          par: number | null;
          slope_rating: number | null;
          tee_set_id: string;
          version: number;
        };
        Insert: {
          bogey_rating?: number | null;
          colour_hex?: string | null;
          course_id: string;
          course_rating?: number | null;
          name: string;
          par?: number | null;
          slope_rating?: number | null;
          tee_set_id?: string;
          version: number;
        };
        Update: {
          bogey_rating?: number | null;
          colour_hex?: string | null;
          course_id?: string;
          course_rating?: number | null;
          name?: string;
          par?: number | null;
          slope_rating?: number | null;
          tee_set_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'tee_sets_course_id_version_fkey';
            columns: ['course_id', 'version'];
            isOneToOne: false;
            referencedRelation: 'course_versions';
            referencedColumns: ['course_id', 'version'];
          },
        ];
      };
      weather_cache: {
        Row: {
          fetched_at: string;
          hour: string;
          lat_r: number;
          lng_r: number;
          payload: NonNullable<Json>;
        };
        Insert: {
          fetched_at?: string;
          hour: string;
          lat_r: number;
          lng_r: number;
          payload: NonNullable<Json>;
        };
        Update: {
          fetched_at?: string;
          hour?: string;
          lat_r?: number;
          lng_r?: number;
          payload?: NonNullable<Json>;
        };
        Relationships: [];
      };
    };
    Views: {
      my_permissions: {
        Row: {
          permission_key: string | null;
          role: Database['public']['Enums']['app_role'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'role_permission_permission_key_fkey';
            columns: ['permission_key'];
            isOneToOne: false;
            referencedRelation: 'permission';
            referencedColumns: ['permission_key'];
          },
        ];
      };
      role_effective_permission: {
        Row: {
          permission_key: string | null;
          role: Database['public']['Enums']['app_role'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'role_permission_permission_key_fkey';
            columns: ['permission_key'];
            isOneToOne: false;
            referencedRelation: 'permission';
            referencedColumns: ['permission_key'];
          },
        ];
      };
    };
    Functions: {
      can_read_course: { Args: { cid: string }; Returns: boolean };
      can_write_course: { Args: { cid: string }; Returns: boolean };
      course_assert_writer: { Args: { p_course_id: string }; Returns: undefined };
      course_copy_version: {
        Args: { p_course_id: string; p_from: number; p_to: number };
        Returns: undefined;
      };
      course_create: {
        Args: {
          p_boundary?: Json;
          p_country: string;
          p_lat: number;
          p_lng: number;
          p_name: string;
          p_osm_relation_id?: string;
          p_source?: Database['public']['Enums']['course_source'];
        };
        Returns: string;
      };
      course_elevation_extent: { Args: { p_course_id: string; p_version?: number }; Returns: Json };
      course_ensure_draft: { Args: { p_course_id: string }; Returns: undefined };
      course_geog: { Args: { j: Json }; Returns: unknown };
      course_geojson: { Args: { g: unknown }; Returns: Json };
      course_get: { Args: { p_course_id: string; p_version?: number }; Returns: Json };
      course_publish: { Args: { p_change_reason?: string; p_course_id: string }; Returns: number };
      course_save_draft: { Args: { p_course_id: string; p_doc: Json }; Returns: undefined };
      has_permission: { Args: { p_key: string }; Returns: boolean };
    };
    Enums: {
      app_role: 'player' | 'curator' | 'admin';
      club_kind: 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';
      course_source: 'osm' | 'editor' | 'igolf';
      course_status: 'draft' | 'published';
      device_kind: 'garmin_ciq';
      feature_kind:
        | 'fairway'
        | 'first_cut'
        | 'rough'
        | 'deep_rough'
        | 'bunker'
        | 'water'
        | 'ob'
        | 'hardpan'
        | 'pine_straw'
        | 'tree'
        | 'wooded'
        | 'cart_path';
      feature_penalty: 'none' | 'lateral' | 'yellow' | 'ob';
      grade: 'good' | 'poor';
      handedness: 'R' | 'L';
      lie:
        | 'tee'
        | 'fairway'
        | 'first_cut'
        | 'rough'
        | 'deep_rough'
        | 'sand'
        | 'hardpan'
        | 'pine_straw'
        | 'green';
      pattern_confidence: 'seeded' | 'forming' | 'established';
      penalty: 'none' | 'lateral' | 'yellow' | 'ob' | 'unplayable';
      permission_verb: 'view' | 'write' | 'refit' | 'publish';
      plan: 'free' | 'pro';
      round_status: 'live' | 'complete' | 'abandoned';
      sg_category: 'ott' | 'app' | 'arg' | 'putt';
      shape: 'straight' | 'draw' | 'fade';
      shot_source: 'course' | 'sim' | 'manual';
      sim_source: 'gspro' | 'square';
      slope_strength: 'none' | 'mild' | 'severe';
      strike: 'good' | 'fat' | 'thin' | 'toe' | 'heel' | 'top' | 'shank';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ['player', 'curator', 'admin'],
      club_kind: ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'],
      course_source: ['osm', 'editor', 'igolf'],
      course_status: ['draft', 'published'],
      device_kind: ['garmin_ciq'],
      feature_kind: [
        'fairway',
        'first_cut',
        'rough',
        'deep_rough',
        'bunker',
        'water',
        'ob',
        'hardpan',
        'pine_straw',
        'tree',
        'wooded',
        'cart_path',
      ],
      feature_penalty: ['none', 'lateral', 'yellow', 'ob'],
      grade: ['good', 'poor'],
      handedness: ['R', 'L'],
      lie: [
        'tee',
        'fairway',
        'first_cut',
        'rough',
        'deep_rough',
        'sand',
        'hardpan',
        'pine_straw',
        'green',
      ],
      pattern_confidence: ['seeded', 'forming', 'established'],
      penalty: ['none', 'lateral', 'yellow', 'ob', 'unplayable'],
      permission_verb: ['view', 'write', 'refit', 'publish'],
      plan: ['free', 'pro'],
      round_status: ['live', 'complete', 'abandoned'],
      sg_category: ['ott', 'app', 'arg', 'putt'],
      shape: ['straight', 'draw', 'fade'],
      shot_source: ['course', 'sim', 'manual'],
      sim_source: ['gspro', 'square'],
      slope_strength: ['none', 'mild', 'severe'],
      strike: ['good', 'fat', 'thin', 'toe', 'heel', 'top', 'shank'],
    },
  },
} as const;
