import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch("https://api.gateio.ws/api/v4/spot/order_book?currency_pair=LF_USDT&limit=100&with_id=true", {
      headers:{ Accept:"application/json" }, cache:"no-store",
    });
    if (!response.ok) {
      const details = await response.text();
      return NextResponse.json({ message:response.status===404?"LF/USDT is not available on Gate.io":"Gate.io market data is temporarily unavailable", details:details.slice(0,160) }, { status:response.status });
    }
    const data = await response.json();
    return NextResponse.json(data,{ headers:{ "Cache-Control":"public, s-maxage=2, stale-while-revalidate=4", "Access-Control-Allow-Origin":"*" } });
  } catch {
    return NextResponse.json({ message:"Could not connect to Gate.io" },{ status:502 });
  }
}
