import { Logo } from "~/components/Logo";
import { NavLink } from "~/components/NavLink";
import { FormField } from "~/components/FormField";
import { Button } from "~/components/Button";
import { SmallPrint } from "~/components/Footer";

export const FooterNavigation = () => {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto max-w-5xl px-5 pb-14 pt-16">
        <div className="flex w-full justify-between pb-8">
          <Logo />
          <div className="flex justify-between gap-10">
            <ul>
              <p className="mb-2 text-xs font-semibold text-gray-100">
                Resources
              </p>
              <li>
                <NavLink to="/docs/introduction">Documentation</NavLink>
              </li>
              <li>
                <NavLink to="/blog">Blog</NavLink>
              </li>
            </ul>
            <ul>
              <p className="mb-2 text-xs font-semibold text-gray-100">
                Company
              </p>
              <li>
                <NavLink to="/about">About</NavLink>
              </li>
              <li>
                <NavLink to="/terms">Terms of Use</NavLink>
              </li>
              <li>
                <NavLink to="/privacy">Privacy Policy</NavLink>
              </li>
            </ul>
            <ul>
              <p className="mb-2 text-xs font-semibold text-gray-100">
                Support
              </p>
              <li>
                <NavLink to="/help">Help center</NavLink>
              </li>
              <li>
                <NavLink to="/contact">Contact</NavLink>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-5 border-t border-white/10 py-8 md:flex-row">
          <div className="w-full md:w-[30%]">
            <p className="text-xs">
              Subscribe to receive our latest updates right to your inbox 🚀
            </p>
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            <FormField
              className="w-full"
              name="email"
              placeholder="Enter your email"
              size="xs"
              inputProps={{ className: "text-xs" }}
            />
            <Button size="sm" shape="square" type="submit">
              Submit
            </Button>
          </div>
        </div>
        <SmallPrint />
      </div>
    </footer>
  );
};
