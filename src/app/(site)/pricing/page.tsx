import Container from "~/core/ui/Container";
import PricingTable from "~/components/PricingTable";
import Hero from "~/core/ui/Hero";
import SubHeading from "~/core/ui/SubHeading";

export const metadata = {
  title: "Pricing",
};

function PricingPage() {
  return (
    <Container>
      <div className="flex flex-col space-y-8">
        <div className="flex flex-col items-center">
          <Hero>Pricing</Hero>
          <SubHeading>Fair pricing for your customers</SubHeading>
        </div>

        <PricingTable />
      </div>
    </Container>
  );
}

export default PricingPage;
