namespace acme.orders;

using { cuid, managed, Currency } from '@sap/cds/common';

/** An order placed by a customer in the web shop. */
entity Orders : cuid, managed {
  customer : Association to Customers;
  items    : Composition of many OrderItems on items.order = $self;
  status   : String(20) default 'NEW';
  total    : Decimal(15, 2);
  currency : Currency;
}

entity OrderItems : cuid {
  order    : Association to Orders;
  product  : Association to Products;
  quantity : Integer;
  price    : Decimal(15, 2);
}

entity Products : cuid {
  name  : String(111);
  stock : Integer;
  price : Decimal(15, 2);
}

/** Replicated from S/4HANA business partners. */
entity Customers {
  key ID      : String(10);
  name        : String(80);
  creditLimit : Decimal(15, 2);
}
