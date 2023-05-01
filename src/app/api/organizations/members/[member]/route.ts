import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import MembershipRole from "~/lib/organizations/types/membership-role";

import {
  deleteMembershipById,
  updateMembershipById,
} from "~/lib/memberships/mutations";

import getSupabaseServerClient from "~/core/supabase/server-client";
import getLogger from "~/core/logger";

type Params = { params: { member: string } };

export async function PUT(request: Request, { params }: Params) {
  const membershipId = Number(params.member);
  const client = getSupabaseServerClient();
  const body = await request.json();

  return handleUpdateMemberRequest(client, membershipId, body);
}

export async function DELETE(request: Request, { params }: Params) {
  const membershipId = Number(params.member);
  const client = getSupabaseServerClient();

  return handleRemoveMemberRequest(client, membershipId);
}

async function handleRemoveMemberRequest(
  client: SupabaseClient,
  membershipId: number
) {
  const logger = getLogger();

  logger.info(
    {
      membershipId,
    },
    `Removing member...`
  );

  await deleteMembershipById(client, membershipId);

  logger.info(
    {
      membershipId,
    },
    `Member successfully removed.`
  );

  return NextResponse.json({
    success: true,
  });
}

async function handleUpdateMemberRequest(
  client: SupabaseClient,
  membershipId: number,
  body: UnknownObject
) {
  const logger = getLogger();
  const role = getRoleSchema().parse(Number(body.role));

  logger.info(
    {
      membershipId,
    },
    `Updating member...`
  );

  await updateMembershipById(client, {
    id: membershipId,
    role,
  });

  logger.info(
    {
      membershipId,
    },
    `Member successfully updated.`
  );

  return NextResponse.json({
    success: true,
  });
}

function getRoleSchema() {
  return z.nativeEnum(MembershipRole);
}
