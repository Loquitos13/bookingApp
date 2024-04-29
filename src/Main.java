import javax.swing.*;
import java.awt.*;

class BookingsApp extends JFrame {

    // Components for Room Details View
    private JTextField campoIdQuarto, campoNumeroQuarto, campoCapacidadeAdultos, campoCapacidadeCriancas, campoPreco;
    private JButton getBotaoQuartoDisponivel, botaoReservarQuarto;

    // Components for Booking Details View
    private JTextField bookingIdField, guestFirstNameField, guestLastNameField, checkInDateField, checkOutDateField,
            numberOfAdultsField, numberOfChildrenField, roomIdBookingField, statusIdField;
    private JButton checkInButton, checkOutButton, cancelButton;

    // Components for Homepage
    private JList<String> checkInLista, checkOutLista;

    public BookingsApp() {
        setTitle("Booking App");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(800, 600);
        setLayout(new CardLayout());

        // Initialize components
        iniciarComponentes();

        // Add components to panels and frames
        add(criarDetalhesQuarto(), "RoomDetails");
        add(criarPainelDetalhesReserva(), "BookingDetails");
        add(createHomepagePanel(), "Homepage");

        // Display Homepage by default
        CardLayout cardLayout = (CardLayout) getContentPane().getLayout();
        cardLayout.show(getContentPane(), "Homepage");
    }

    private void iniciarComponentes() {
        // Initialize components for Room Details View

        // Initialize components for Booking Details View

        // Initialize components for Homepage
    }

    private JPanel criarDetalhesQuarto() {
        JPanel panel = new JPanel(new GridLayout(0, 2));

        // Add components to panel for Room Details View

        return panel;
    }

    private JPanel criarPainelDetalhesReserva() {
        JPanel panel = new JPanel(new GridLayout(0, 2));

        // Add components to panel for Booking Details View

        return panel;
    }

    private JPanel createHomepagePanel() {
        JPanel panel = new JPanel(new GridLayout(2, 1));

        // Add components to panel for Homepage

        return panel;
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            BookingsApp app = new BookingsApp();
            app.setVisible(true);
        });
    }
}
