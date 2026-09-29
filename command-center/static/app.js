fetch("/api/products")
  .then((response) => response.json())
  .then((data) => {
    const node = document.getElementById("product");
    if (node) node.textContent = (data.products[0] && data.products[0].name) || "";
  });
