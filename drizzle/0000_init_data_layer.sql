CREATE TYPE "public"."actor_type" AS ENUM('owner', 'portal', 'system');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'suspended', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('active', 'deletion_pending', 'suspended', 'deleted');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100) NOT NULL,
	"resource_id" uuid NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"principal_id" text NOT NULL,
	"route" varchar(255) NOT NULL,
	"resource_id" varchar(255),
	"key" varchar(255) NOT NULL,
	"request_body_hash" varchar(64) NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_requests_scope_key" UNIQUE("principal_id","route","resource_id","key"),
	CONSTRAINT "idempotency_requests_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"phone_e164" varchar(20),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "profiles_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"auth_user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'owner' NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_auth_user_id_key" UNIQUE("workspace_id","auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"bank_account" jsonb,
	"status" "workspace_status" DEFAULT 'active' NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_workspace_id_id_key" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_requests" ADD CONSTRAINT "idempotency_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_requests_expires_at_idx" ON "idempotency_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "profiles_auth_user_id_idx" ON "profiles" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_single_active_owner_per_workspace_key" ON "workspace_members" USING btree ("workspace_id") WHERE role = 'owner' AND status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_single_owned_workspace_per_identity_key" ON "workspace_members" USING btree ("auth_user_id") WHERE role = 'owner' AND status = 'active';--> statement-breakpoint
CREATE INDEX "workspace_members_auth_user_id_status_idx" ON "workspace_members" USING btree ("auth_user_id","status");--> statement-breakpoint
CREATE INDEX "workspaces_status_idx" ON "workspaces" USING btree ("status");