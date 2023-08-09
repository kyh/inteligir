const AppContainer = (props: React.PropsWithChildren) => {
  return (
    <div className="flex w-full flex-1 flex-col p-3">{props.children}</div>
  );
};

export default AppContainer;
