using { acme.orders as db } from '../db/schema';

service OrdersService @(path: '/orders') {
  entity Orders as projection on db.Orders;
  entity OrderItems as projection on db.OrderItems;
  @readonly entity Products as projection on db.Products;

  action cancelOrder(order : UUID, reason : String);
  function creditCheck(customer : String) returns Boolean;

  event OrderCancelled {
    order  : UUID;
    reason : String;
  }
}

service AdminService @(path: '/admin', requires: 'OrderManager') {
  entity Customers as projection on db.Customers;
}
