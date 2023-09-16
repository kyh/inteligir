import testimonialAvatarImage from "@/public/images/testimonial-avatar.png";
import Image from "next/image";

export default function Testimonial() {
  return (
    <div className="flex flex-col space-y-6 text-center">
      <h2 className="max-w-lg text-xl">
        “I manage multiple client projects at once. Starting with Demorepo has
        saved me 3 weeks of initial development time per project.”
      </h2>
      <div className="flex flex-col items-center space-y-1">
        <Image
          src={testimonialAvatarImage}
          width={64}
          height={64}
          alt="Alex Rivera photo"
          className="mb-2 rounded-full"
        />
        <p className="font-medium">Alex Rivera</p>
        <p className="text-gray-500">Founder, AlphaForge Studios</p>
      </div>
    </div>
  );
}
