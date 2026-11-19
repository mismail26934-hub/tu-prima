import { NextResponse } from "next/server";
import { createCustomer, listCustomers } from "@/lib/customers";
import { requirePermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get("include_inactive") === "1";

  if (includeInactive) {
    const denied = await requirePermission("customer", "read");
    if (denied) return denied;
  } else {
    const denied = await requirePermission("job", "read");
    if (denied) return denied;
  }

  return NextResponse.json({
    customers: await listCustomers({ includeInactive }),
  });
}

export async function POST(req: Request) {
  const denied = await requirePermission("customer", "create");
  if (denied) return denied;
  try {
    const body = await req.json();
    const customer = await createCustomer({
      id: body.id ? String(body.id) : undefined,
      code: String(body.code || ""),
      name: String(body.name || ""),
      active: body.active != null ? String(body.active) : undefined,
    });
    return NextResponse.json(customer);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to create customer";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
