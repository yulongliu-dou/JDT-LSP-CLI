
public class TestHover {
    /**
     * Process an order with the given parameters
     * @param orderId the order identifier
     * @param quantity the quantity ordered
     * @return processing result
     */
    public String processOrder(String orderId, int quantity) {
        return "Processed: " + orderId + " x" + quantity;
    }
    
    public static void main(String[] args) {
        TestHover th = new TestHover();
        th.processOrder("ORD001", 5);
    }
}
