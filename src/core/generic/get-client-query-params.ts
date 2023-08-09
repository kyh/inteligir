const getClientQueryParams = () => {
  return new URLSearchParams(window.location.search);
};

export default getClientQueryParams;
