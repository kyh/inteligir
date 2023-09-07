type IconCircleProps = {
  children: React.ReactNode;
};

export default function IconCircle({ children }: IconCircleProps) {
  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-50">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        {children}
      </div>
    </div>
  );
}
