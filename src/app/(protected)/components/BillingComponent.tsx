"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import Stripe from "stripe";
import { Button } from "~/components/ui/button";
import { useRouter } from "next/navigation";

export default function BillingComponent({
  team,
  products,
  prices,
}: {
  team: Team;
  products: Stripe.Product[];
  prices: Stripe.Price[];
}) {
  const router = useRouter();

  const triggerCheckout = async ({
    priceId,
    teamId,
  }: {
    priceId: string;
    teamId: string;
  }) => {
    const response = await fetch("/api/checkout", {
      method: "POST",
      body: JSON.stringify({
        priceId,
        teamId,
      }),
    });

    const { redirectUrl } = await response.json();

    if (response.ok) {
      router.push(redirectUrl);
      return;
    }

    if (response.status === 400) {
      console.error("Bad Request");
      return;
    }
  };

  const triggerPortal = async () => {
    const response = await fetch("/api/portal", {
      method: "POST",
      body: JSON.stringify({
        teamId: team.id,
      }),
    });

    const { redirectUrl } = await response.json();

    if (response.ok) {
      router.push(redirectUrl);
      return;
    }

    if (response.status === 400) {
      console.error("Bad Request");
      return;
    }
  };

  if (team.subscribed) {
    return (
      <div className="flex flex-col space-y-4 lg:flex-row lg:space-x-4 lg:space-y-0">
        <div className="flex justify-center">
          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-center">Subscribed</CardTitle>
              <CardDescription className="text-center">
                You are currently subscribed to Neorepo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center">
                <Button className="p-6" onClick={triggerPortal}>
                  Manage Subscription
                </Button>
              </div>
            </CardContent>

            <CardFooter>
              You can manage your subscription and billing information here.
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <Tabs defaultValue="monthly">
      <TabsList>
        <TabsTrigger value="monthly">Monthly</TabsTrigger>
        <TabsTrigger value="yearly">Yearly</TabsTrigger>
      </TabsList>

      <TabsContent value="monthly">
        <div className="flex flex-col space-y-4 lg:flex-row lg:space-x-4 lg:space-y-0">
          {products.map((product) => {
            const monthlyPrice = prices.find(
              (price) =>
                price.product === product.id &&
                price.recurring?.interval === "month",
            );
            return (
              <Card key={product.id} className="flex-1">
                <CardHeader>
                  <CardTitle className="text-center">{product.name}</CardTitle>
                  <CardDescription className="text-center">
                    {product.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-center">
                    <Button
                      className="p-6"
                      onClick={() =>
                        triggerCheckout({
                          priceId: prices[0].id,
                          teamId: team.id.toString(),
                        })
                      }
                    >
                      Subscribe for $
                      {monthlyPrice && monthlyPrice.unit_amount
                        ? monthlyPrice.unit_amount / 100
                        : "N/A"}{" "}
                      / month
                    </Button>
                  </div>
                </CardContent>
                <CardFooter className="max-w-md text-center">
                  By joining, you will be able to access the team&apos;s
                  projects and collaborate with other members.
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </TabsContent>

      <TabsContent value="yearly">
        <div className="flex flex-col space-y-4 lg:flex-row lg:space-x-4 lg:space-y-0">
          {products.map((product) => {
            const yearlyPrice = prices.find(
              (price) =>
                price.product === product.id &&
                price.recurring?.interval === "year",
            );
            return (
              <Card key={product.id} className="flex-1">
                <CardHeader>
                  <CardTitle className="text-center">{product.name}</CardTitle>
                  <CardDescription className="text-center">
                    {product.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-center">
                    <Button
                      className="p-6"
                      onClick={() =>
                        triggerCheckout({
                          priceId: prices[1].id,
                          teamId: team.id.toString(),
                        })
                      }
                    >
                      Subscribe for $
                      {yearlyPrice && yearlyPrice.unit_amount
                        ? yearlyPrice.unit_amount / 100
                        : "N/A"}{" "}
                      / year
                    </Button>
                  </div>
                </CardContent>
                <CardFooter className="max-w-md text-center">
                  By joining, you will be able to access the team&apos;s
                  projects and collaborate with other members.
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </TabsContent>
    </Tabs>
  );
}
